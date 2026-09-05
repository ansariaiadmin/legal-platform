import { Inject, Injectable, Logger } from '@nestjs/common';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';
import type { TelephonyProviderConfig } from '../../providers/telephony/telephony.provider';

/**
 * Comms settings (P2a): the LAWYER wires THEIR OWN SMS panel + call panel —
 * credentials live server-side through the StorageProvider port and every
 * read returns MASKED values. "Send a test SMS", "place a test call" hit the
 * configured URL for real and return honest latency — the green pill is
 * earned, never painted.
 */

const CONFIG_KEY = 'runtime/comms-config.json';

export interface SmsPanelConfig {
  provider: 'kavenegar' | 'ghasedak' | 'smsir' | 'custom';
  baseUrl: string;
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

@Injectable()
export class CommsSettingsService {
  private readonly logger = new Logger(CommsSettingsService.name);
  private sms: SmsPanelConfig | null = null;
  private call: CallPanelConfig | null = null;
  private updatedAt: string | undefined;
  private loaded = false;

  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.storage.get(CONFIG_KEY);
      const parsed = JSON.parse(raw.toString('utf8')) as { sms: SmsPanelConfig | null; call: CallPanelConfig | null; updatedAt?: string };
      this.sms = parsed.sms ?? null;
      this.call = parsed.call ?? null;
      this.updatedAt = parsed.updatedAt;
    } catch {
      /* first boot — unconfigured is the honest state */
    }
    this.loaded = true;
  }

  async view(): Promise<CommsView> {
    await this.ensureLoaded();
    return {
      sms: this.sms
        ? { configured: true, provider: this.sms.provider, baseUrl: this.sms.baseUrl, apiKeyMasked: `••••${this.sms.apiKey.slice(-4)}`, senderLine: this.sms.senderLine }
        : { configured: false },
      call: this.call
        ? { configured: true, baseUrl: this.call.baseUrl, fromNumber: this.call.fromNumber, accountId: this.call.accountId }
        : { configured: false },
      updatedAt: this.updatedAt,
    };
  }

  async setSmsPanel(cfg: SmsPanelConfig, actorId: string): Promise<void> {
    await this.ensureLoaded();
    this.sms = cfg;
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

  getSms(): SmsPanelConfig | null {
    return this.sms;
  }

  getCall(): CallPanelConfig | null {
    return this.call;
  }

  /** Telephony port fed by the lawyer's own panel (wires TelephonyAdapter). */
  telephonyConfig(): TelephonyProviderConfig | null {
    if (!this.call) return null;
    return {
      accountId: this.call.accountId,
      authToken: this.call.authToken,
      phoneNumber: this.call.fromNumber,
      webhookUrl: this.call.baseUrl,
    };
  }

  /** Honest test: hit the configured endpoint, report latency or failure. */
  async testSms(to: string, text: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    await this.ensureLoaded();
    if (!this.sms) return { ok: false, latencyMs: 0, error: 'پنل پیامکی هنوز وصل نیست' };
    return this.shot(`${this.sms.baseUrl.replace(/\/$/, '')}/v1/${this.sms.apiKey}/sms/send.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `receptor=${encodeURIComponent(to)}&message=${encodeURIComponent(text)}`,
    });
  }

  async testCall(toNumber: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    await this.ensureLoaded();
    if (!this.call) return { ok: false, latencyMs: 0, error: 'پنل تماس هنوز وصل نیست' };
    return this.shot(`${this.call.baseUrl.replace(/\/$/, '')}/calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Account-Id': this.call.accountId, 'X-Auth-Token': this.call.authToken },
      body: JSON.stringify({ to: toNumber, from: this.call.fromNumber, source: 'legal-platform-test' }),
    });
  }

  private async shot(url: string, init: RequestInit): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const started = Date.now();
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
      const latencyMs = Date.now() - started;
      if (!res.ok) return { ok: false, latencyMs, error: `پاسخ ${res.status} از پنل` };
      return { ok: true, latencyMs };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, error: (err as Error).message };
    }
  }

  private async persist(actorId: string): Promise<void> {
    await this.storage.put({
      key: CONFIG_KEY,
      content: Buffer.from(JSON.stringify({ sms: this.sms, call: this.call, updatedAt: this.updatedAt, updatedBy: actorId })),
      contentType: 'application/json',
      metadata: { updatedBy: actorId },
    });
  }
}
