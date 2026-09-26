import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';
import type { TelephonyProviderConfig } from '../../providers/telephony/telephony.provider';
import type { SmsProvider } from '../../providers/sms/sms.provider';
import { KavenegarSmsAdapter } from '../../providers/sms/kavenegar.adapter';
import { GhasedakSmsAdapter } from '../../providers/sms/ghasedak.adapter';
import { EncryptionService } from '../../security/encryption.service';

/**
 * The office's own SMS panel and call server, configured from the dashboard
 * (Phone consultations section).
 *
 * - Credentials are stored through the StorageProvider port, encrypted with
 *   ENCRYPTION_MASTER_KEY (AES-256-GCM); reads return masked values only.
 * - A configured SMS panel is the gateway for every SMS the platform sends
 *   (sign-in codes and client notifications) — see RoutingSmsProvider.
 * - "Send a test SMS" goes through the same adapter as real messages, and
 *   "place a test call" calls the configured server; both report the real
 *   result and latency.
 */

const CONFIG_KEY = 'runtime/comms-config.json';
const ENC_PREFIX = 'enc:v1:';

export type SmsPanelProvider = 'kavenegar' | 'ghasedak';
export const SMS_PANEL_PROVIDERS: readonly SmsPanelProvider[] = ['kavenegar', 'ghasedak'];

export interface SmsPanelConfig {
  provider: SmsPanelProvider;
  /** Optional gateway URL override; the provider's official endpoint when empty. */
  baseUrl?: string;
  apiKey: string;
  senderLine?: string;
}

export interface CallPanelConfig {
  baseUrl: string;
  accountId: string;
  authToken: string;
  fromNumber: string;
}

export interface CommsView {
  sms: { configured: boolean; provider?: string; baseUrl?: string; apiKeyMasked?: string; senderLine?: string };
  call: { configured: boolean; baseUrl?: string; fromNumber?: string; accountId?: string };
  updatedAt?: string;
}

export interface CommsTestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

@Injectable()
export class CommsSettingsService {
  private readonly logger = new Logger(CommsSettingsService.name);
  private sms: SmsPanelConfig | null = null;
  private call: CallPanelConfig | null = null;
  private updatedAt: string | undefined;
  private loading: Promise<void> | null = null;
  private smsAdapter: { signature: string; adapter: SmsProvider } | null = null;

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Optional() private readonly encryption?: EncryptionService,
  ) {}

  /** Loads the stored configuration once; concurrent callers share one read. */
  private ensureLoaded(): Promise<void> {
    if (!this.loading) {
      this.loading = (async () => {
        try {
          const raw = await this.storage.get(CONFIG_KEY);
          const parsed = JSON.parse(raw.toString('utf8')) as {
            sms: (SmsPanelConfig & { provider: string }) | null;
            call: CallPanelConfig | null;
            updatedAt?: string;
          };
          if (parsed.sms && (SMS_PANEL_PROVIDERS as readonly string[]).includes(parsed.sms.provider)) {
            this.sms = { ...parsed.sms, apiKey: this.reveal(parsed.sms.apiKey) } as SmsPanelConfig;
          } else if (parsed.sms) {
            this.logger.warn(`Stored SMS panel uses an unsupported provider (${parsed.sms.provider}); reconnect it in the dashboard.`);
          }
          this.call = parsed.call ? { ...parsed.call, authToken: this.reveal(parsed.call.authToken) } : null;
          this.updatedAt = parsed.updatedAt;
        } catch {
          // Nothing stored yet (or unreadable): "not connected" is the correct state.
        }
      })();
    }
    return this.loading;
  }

  async view(): Promise<CommsView> {
    await this.ensureLoaded();
    return {
      sms: this.sms
        ? {
            configured: true,
            provider: this.sms.provider,
            baseUrl: this.sms.baseUrl,
            apiKeyMasked: `••••${this.sms.apiKey.slice(-4)}`,
            senderLine: this.sms.senderLine,
          }
        : { configured: false },
      call: this.call
        ? { configured: true, baseUrl: this.call.baseUrl, fromNumber: this.call.fromNumber, accountId: this.call.accountId }
        : { configured: false },
      updatedAt: this.updatedAt,
    };
  }

  async setSmsPanel(cfg: SmsPanelConfig, actorId: string): Promise<void> {
    await this.ensureLoaded();
    this.sms = {
      provider: cfg.provider,
      apiKey: cfg.apiKey.trim(),
      ...(cfg.baseUrl?.trim() ? { baseUrl: cfg.baseUrl.trim() } : {}),
      ...(cfg.senderLine?.trim() ? { senderLine: cfg.senderLine.trim() } : {}),
    };
    this.smsAdapter = null;
    this.updatedAt = new Date().toISOString();
    await this.persist(actorId);
    this.logger.log(`SMS panel connected by ${actorId}: ${cfg.provider}`);
  }

  async setCallPanel(cfg: CallPanelConfig, actorId: string): Promise<void> {
    await this.ensureLoaded();
    this.call = cfg;
    this.updatedAt = new Date().toISOString();
    await this.persist(actorId);
    this.logger.log(`Call panel connected by ${actorId}: ${cfg.fromNumber}`);
  }

  async getSms(): Promise<SmsPanelConfig | null> {
    await this.ensureLoaded();
    return this.sms;
  }

  async getCall(): Promise<CallPanelConfig | null> {
    await this.ensureLoaded();
    return this.call;
  }

  /**
   * The SMS adapter for the connected panel, or null when none is connected
   * (callers then fall back to the environment's SMS_PROVIDER).
   */
  async panelSmsProvider(): Promise<SmsProvider | null> {
    await this.ensureLoaded();
    if (!this.sms) return null;
    const signature = `${this.sms.provider}|${this.sms.baseUrl ?? ''}|${this.sms.apiKey}|${this.sms.senderLine ?? ''}`;
    if (this.smsAdapter?.signature !== signature) {
      this.smsAdapter = { signature, adapter: buildSmsAdapter(this.sms) };
    }
    return this.smsAdapter.adapter;
  }

  /** Telephony port fed by the office's own call server. */
  async telephonyConfig(): Promise<TelephonyProviderConfig | null> {
    await this.ensureLoaded();
    if (!this.call) return null;
    return {
      accountId: this.call.accountId,
      authToken: this.call.authToken,
      phoneNumber: this.call.fromNumber,
      webhookUrl: this.call.baseUrl,
    };
  }

  /** Sends a real SMS through the connected panel (same adapter as real messages). */
  async testSms(to: string, text: string): Promise<CommsTestResult> {
    const adapter = await this.panelSmsProvider();
    if (!adapter) return { ok: false, latencyMs: 0, error: 'پنل پیامک هنوز متصل نشده است.' };
    const started = Date.now();
    try {
      const r = await adapter.sendSms({ phone: to, message: text });
      return r.success
        ? { ok: true, latencyMs: Date.now() - started }
        : { ok: false, latencyMs: Date.now() - started, error: r.error ?? 'پنل پیامک پیام را نپذیرفت.' };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, error: (err as Error).message };
    }
  }

  async testCall(toNumber: string): Promise<CommsTestResult> {
    await this.ensureLoaded();
    if (!this.call) return { ok: false, latencyMs: 0, error: 'پنل تماس هنوز متصل نشده است.' };
    const started = Date.now();
    try {
      const res = await fetch(`${this.call.baseUrl.replace(/\/$/, '')}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Account-Id': this.call.accountId, 'X-Auth-Token': this.call.authToken },
        body: JSON.stringify({ to: toNumber, from: this.call.fromNumber, source: 'legal-platform-test' }),
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - started;
      if (!res.ok) return { ok: false, latencyMs, error: `سرور تماس با کد ${res.status} پاسخ داد.` };
      return { ok: true, latencyMs };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, error: (err as Error).message };
    }
  }

  private seal(secret: string): string {
    return this.encryption ? this.encryption.encrypt(secret) : secret;
  }

  private reveal(stored: string): string {
    if (!stored.startsWith(ENC_PREFIX)) return stored; // written before encryption was added
    if (!this.encryption) throw new Error('encrypted comms credentials but no EncryptionService');
    return this.encryption.decrypt(stored);
  }

  private async persist(actorId: string): Promise<void> {
    const sms = this.sms ? { ...this.sms, apiKey: this.seal(this.sms.apiKey) } : null;
    const call = this.call ? { ...this.call, authToken: this.seal(this.call.authToken) } : null;
    await this.storage.put({
      key: CONFIG_KEY,
      content: Buffer.from(JSON.stringify({ sms, call, updatedAt: this.updatedAt, updatedBy: actorId })),
      contentType: 'application/json',
      metadata: { updatedBy: actorId },
    });
  }
}

/** Builds the real gateway adapter for a panel configuration. */
function buildSmsAdapter(cfg: SmsPanelConfig): SmsProvider {
  const values: Record<string, string | undefined> =
    cfg.provider === 'kavenegar'
      ? {
          KAVENEGAR_API_KEY: cfg.apiKey,
          KAVENEGAR_SENDER: cfg.senderLine,
          KAVENEGAR_BASE_URL: cfg.baseUrl ? kavenegarBase(cfg.baseUrl) : undefined,
        }
      : {
          GHASEDAK_API_KEY: cfg.apiKey,
          GHASEDAK_LINE_NUMBER: cfg.senderLine,
          GHASEDAK_BASE_URL: cfg.baseUrl?.replace(/\/$/, ''),
        };
  const config = { get: <T = string>(key: string) => values[key] as T | undefined } as unknown as ConfigService;
  return cfg.provider === 'kavenegar' ? new KavenegarSmsAdapter(config) : new GhasedakSmsAdapter(config);
}

/** Kavenegar's API lives under /v1; accept the bare host as well. */
function kavenegarBase(url: string): string {
  const trimmed = url.replace(/\/$/, '');
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}
