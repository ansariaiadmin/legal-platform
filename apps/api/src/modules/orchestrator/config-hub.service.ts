import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../../security/encryption.service';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import { assertLanUrlAllowed, assertPublicEgressAllowed } from '../../security/egress';
import type { StorageProvider } from '../../providers/storage/storage.provider';

/**
 * The dashboard's brain-connector (ADR-014). The OWNER — even with zero
 * technical knowledge — pastes a local model URL or a cloud API key and the
 * Leader's brain re-wires WITHOUT a redeploy. Runtime overrides persist via
 * the StorageProvider port and BEAT env vars; the secrecy law
 * (privileged → never cloud, ADR-004) is enforced in the router and can never
 * be relaxed from here — the config UI has no switch for it.
 */

export const BRAIN_CONFIG_KEY = 'runtime/brain-config.json';
export const DEPLOYMENT_PROFILE_KEY = 'runtime/deployment-profile.json';

export type BrainTarget = 'local' | 'cloud';
export type PresetTier = 'spartan' | 'counsel' | 'senator';

export interface BrainConfig {
  local?: { baseUrl: string; model: string };
  cloud?: { baseUrl?: string; model: string; apiKey: string };
  /** last tier the owner picked from the preset picker */
  preset?: PresetTier;
  updatedAt?: string;
  updatedBy?: string;
}

/**
 * P7-T5: deployment profile — the knobs a NEW country touches. Anyone, in
 * any country, can re-skin the platform for their market with ONE patch:
 * default UI locale (fa|en), jurisdiction label, currency for plans,
 * timezone, legal-system shape. Nothing here changes WHICH law is true —
 * it changes how the office is presented. Persisted like brain config.
 */
export type PlatformLocale = 'fa' | 'en';

export interface DeploymentProfile {
  defaultLocale: PlatformLocale;
  country: string;            // ISO-ish label shown in UI ('Iran', 'Germany', …)
  currency: string;           // 'IRT' (تومان) default; shown on plans
  timezone: string;           // IANA, e.g. 'Asia/Tehran'
  legalSystem: 'civil-law' | 'common-law' | 'custom';
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_DEPLOYMENT_PROFILE: DeploymentProfile = {
  defaultLocale: 'fa',
  country: 'Iran',
  currency: 'IRT',
  timezone: 'Asia/Tehran',
  legalSystem: 'civil-law',
};

export interface BrainView {
  local: { baseUrl: string | null; model: string | null; source: 'env' | 'runtime' | 'none' };
  cloud: {
    baseUrl: string | null;
    model: string | null;
    apiKeyMasked: string | null; // ****last4 — raw secrets NEVER escape
    source: 'env' | 'runtime' | 'none';
  };
  preset: PresetTier;
  effectivePolicy: string;
  lendingScenario: string; // human-readable: which model lends to the fleet
}

@Injectable()
export class ConfigHubService {
  private readonly logger = new Logger(ConfigHubService.name);
  private overrides: BrainConfig = {};
  private profile: DeploymentProfile = { ...DEFAULT_DEPLOYMENT_PROFILE };
  private profileLoaded = false;
  private loaded = false;

  constructor(
    private readonly config: ConfigService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Optional() private readonly encryption?: EncryptionService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureLoaded();
  }

  /** Hot, synchronous view — safe only after boot load (module init). */
  peek(): BrainConfig {
    return this.overrides;
  }

  /** Deployment profile (P7-T5) — hot read; defaults are a full Iran stack. */
  peekProfile(): DeploymentProfile {
    return this.profile;
  }

  async getProfile(): Promise<DeploymentProfile> {
    await this.ensureProfileLoaded();
    return { ...this.profile };
  }

  async setProfile(patch: Partial<DeploymentProfile>, actorId: string): Promise<DeploymentProfile> {
    await this.ensureProfileLoaded();
    const next: DeploymentProfile = {
      ...this.profile,
      ...Object.fromEntries(
        Object.entries(patch).filter(([k, v]) =>
          v !== undefined &&
          ['defaultLocale', 'country', 'currency', 'timezone', 'legalSystem'].includes(k),
        ),
      ),
    };
    if (patch.defaultLocale !== undefined && patch.defaultLocale !== 'fa' && patch.defaultLocale !== 'en') {
      throw new Error('defaultLocale must be fa|en');
    }
    if (patch.legalSystem !== undefined && !['civil-law', 'common-law', 'custom'].includes(patch.legalSystem)) {
      throw new Error('legalSystem must be civil-law|common-law|custom');
    }
    this.profile = {
      ...next,
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
    };
    await this.storage.put({
      key: DEPLOYMENT_PROFILE_KEY,
      content: Buffer.from(JSON.stringify(this.profile, null, 2)),
      contentType: 'application/json',
      metadata: { updatedBy: actorId },
    });
    this.logger.log(`deployment profile updated by=${actorId} locale=${this.profile.defaultLocale} country=${this.profile.country}`);
    return { ...this.profile };
  }

  private async ensureProfileLoaded(): Promise<void> {
    if (this.profileLoaded) return;
    try {
      const raw = await this.storage.get(DEPLOYMENT_PROFILE_KEY);
      const parsed = JSON.parse(raw.toString('utf8')) as Partial<DeploymentProfile>;
      this.profile = { ...DEFAULT_DEPLOYMENT_PROFILE, ...parsed };
    } catch { /* first boot: Iran defaults stand */ }
    this.profileLoaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.storage.get(BRAIN_CONFIG_KEY);
      const stored = JSON.parse(raw.toString('utf8')) as BrainConfig;
      if (stored.cloud?.apiKey?.startsWith('enc:v1:')) {
        if (!this.encryption) throw new Error('encrypted AI key but no EncryptionService');
        stored.cloud = { ...stored.cloud, apiKey: this.encryption.decrypt(stored.cloud.apiKey) };
      }
      this.overrides = stored;
    } catch {
      this.overrides = {}; // first boot — env only, perfectly fine
    }
    this.loaded = true;
  }

  /** Effective local brain — runtime override wins, env is fallback. */
  async effectiveLocal(): Promise<{ baseUrl: string; model: string } | null> {
    await this.ensureLoaded();
    if (this.overrides.local?.baseUrl) return this.overrides.local;
    const baseUrl = this.config.get<string>('AI_LOCAL_BASE_URL') || '';
    if (!baseUrl) return null;
    return { baseUrl, model: this.config.get<string>('AI_LOCAL_MODEL') || 'local-box-default' };
  }

  async effectiveCloud(): Promise<{ baseUrl: string | null; model: string; apiKey: string | null } | null> {
    await this.ensureLoaded();
    if (this.overrides.cloud?.apiKey) {
      return {
        baseUrl: this.overrides.cloud.baseUrl ?? null,
        model: this.overrides.cloud.model,
        apiKey: this.overrides.cloud.apiKey,
      };
    }
    const apiKey = this.config.get<string>('AI_API_KEY') || '';
    const baseUrl = this.config.get<string>('AI_BASE_URL') || '';
    if (!apiKey && !baseUrl) return null;
    return {
      baseUrl: baseUrl || null,
      model: this.config.get<string>('AI_CLOUD_MODEL') || this.config.get<string>('AI_MODEL') || 'leader-gateway-default',
      apiKey: apiKey || null,
    };
  }

  async view(): Promise<BrainView> {
    await this.ensureLoaded();
    const local = await this.effectiveLocal();
    const cloud = await this.effectiveCloud();
    const preset = this.overrides.preset ?? tierFromEnv(this.config);
    return {
      local: {
        baseUrl: local?.baseUrl ?? null,
        model: local?.model ?? null,
        source: this.overrides.local ? 'runtime' : local ? 'env' : 'none',
      },
      cloud: {
        baseUrl: cloud?.baseUrl ?? null,
        model: cloud?.model ?? null,
        apiKeyMasked: cloud?.apiKey ? `••••${cloud.apiKey.slice(-4)}` : null,
        source: this.overrides.cloud ? 'runtime' : (cloud?.apiKey || cloud?.baseUrl) ? 'env' : 'none',
      },
      preset,
      effectivePolicy: policyFor(preset),
      lendingScenario: describeLending(local != null, cloud != null),
    };
  }

  /** The "connect a brain" action — one paste, one save, effective NOW. */
  async setBrain(
    patch: { target: BrainTarget; baseUrl?: string; model?: string; apiKey?: string },
    actorId: string,
  ): Promise<BrainView> {
    await this.ensureLoaded();
    if (patch.target === 'local') {
      if (!patch.baseUrl) throw new Error('local brain needs a baseUrl');
      this.overrides.local = { baseUrl: patch.baseUrl.trim(), model: patch.model?.trim() || 'local-box-default' };
    } else {
      if (!patch.apiKey) throw new Error('cloud brain needs an apiKey');
      this.overrides.cloud = {
        baseUrl: patch.baseUrl?.trim() || undefined,
        model: patch.model?.trim() || 'leader-gateway-default',
        apiKey: patch.apiKey.trim(),
      };
    }
    await this.persist(actorId);
    this.logger.log(`brain reconnected: target=${patch.target} by=${actorId}`);
    return this.view();
  }

  async setPreset(preset: PresetTier, actorId: string): Promise<BrainView> {
    await this.ensureLoaded();
    this.overrides.preset = preset;
    await this.persist(actorId);
    this.logger.log(`preset changed to ${preset} by ${actorId}`);
    return this.view();
  }

  async currentPreset(): Promise<PresetTier> {
    await this.ensureLoaded();
    return this.overrides.preset ?? tierFromEnv(this.config);
  }

  /**
   * Probe a candidate endpoint BEFORE saving — honest `{ok:false,error}` when
   * it can't serve, so the dashboard is truthful (never a green theater).
   */
  async testConnection(input: {
    target: BrainTarget;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  }): Promise<{ ok: boolean; latencyMs?: number; error?: string; detail?: string }> {
    const baseUrl = input.baseUrl?.trim() || (input.target === 'local' ? (await this.effectiveLocal())?.baseUrl : (await this.effectiveCloud())?.baseUrl);
    if (!baseUrl) return { ok: false, error: 'هیچ آدرسی تنظیم نشده است.' };
    // SSRF border (FIELD REVIEW 2026-09-05 #3): office-configured URLs must
    // pass the egress guard before we ever connect — cloud lane is
    // https/public/allowlisted, local lane stays LAN-friendly by design.
    try {
      if (input.target === 'local') assertLanUrlAllowed(baseUrl);
      else await assertPublicEgressAllowed(baseUrl, { allowlist: this.config.get<string>('AI_EGRESS_ALLOW') });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const started = Date.now();
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/models`, {
        headers: input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {},
        signal: AbortSignal.timeout(4000),
      });
      const latencyMs = Date.now() - started;
      if (!res.ok) {
        return { ok: false, latencyMs, error: `سرور پاسخ ${res.status} داد.` };
      }
      return { ok: true, latencyMs, detail: 'سرویس مدل پاسخ درست داد' };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, error: (err as Error).message };
    }
  }

  private async persist(actorId: string): Promise<void> {
    this.overrides.updatedAt = new Date().toISOString();
    this.overrides.updatedBy = actorId;
    await this.storage.put({
      key: BRAIN_CONFIG_KEY,
      // The cloud API key is encrypted at rest (ENCRYPTION_MASTER_KEY).
      content: Buffer.from(
        JSON.stringify(
          this.overrides.cloud && this.encryption
            ? { ...this.overrides, cloud: { ...this.overrides.cloud, apiKey: this.encryption.encrypt(this.overrides.cloud.apiKey) } }
            : this.overrides,
          null,
          2,
        ),
      ),
      contentType: 'application/json',
      metadata: { updatedBy: actorId },
    });
  }
}

export function tierFromEnv(config: ConfigService): PresetTier {
  const t = config.get<string>('AGENT_TIER');
  return t === 'senator' ? 'senator' : t === 'counsel' ? 'counsel' : 'spartan';
}

function policyFor(preset: PresetTier): string {
  if (preset === 'senator') return 'hybrid_cloud_first';
  if (preset === 'counsel') return 'hybrid_local_first';
  return 'local_only';
}

function describeLending(hasLocal: boolean, hasCloud: boolean): string {
  if (hasLocal && hasCloud) return 'مدل محلی و سرویس ابری هر دو متصل‌اند؛ پیش‌تنظیم تعیین می‌کند کدام اول استفاده شود.';
  if (hasCloud) return 'فقط سرویس ابری متصل است؛ همهٔ دستیاران از آن استفاده می‌کنند.';
  if (hasLocal) return 'فقط مدل محلی متصل است؛ همهٔ دستیاران از آن استفاده می‌کنند و داده از سرور شما خارج نمی‌شود.';
  return 'هنوز مدلی متصل نشده است؛ فقط پاسخ‌های قاعده‌محور و بدون مدل در دسترس‌اند.';
}
