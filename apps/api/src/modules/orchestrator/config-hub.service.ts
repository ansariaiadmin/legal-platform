import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
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
  private loaded = false;

  constructor(
    private readonly config: ConfigService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureLoaded();
  }

  /** Hot, synchronous view — safe only after boot load (module init). */
  peek(): BrainConfig {
    return this.overrides;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.storage.get(BRAIN_CONFIG_KEY);
      this.overrides = JSON.parse(raw.toString('utf8')) as BrainConfig;
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
      return { ok: true, latencyMs, detail: 'endpoint پاسخ درست داد' };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, error: (err as Error).message };
    }
  }

  private async persist(actorId: string): Promise<void> {
    this.overrides.updatedAt = new Date().toISOString();
    this.overrides.updatedBy = actorId;
    await this.storage.put({
      key: BRAIN_CONFIG_KEY,
      content: Buffer.from(JSON.stringify(this.overrides, null, 2)),
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
  if (hasLocal && hasCloud) return 'دو مغز وصل است — لیدر در صورت نیاز مغزِ خود را به ناوگان قرض می‌دهد.';
  if (hasCloud) return 'فقط مغز ابری — همه‌ی ناوگان از مغزِ لیدر قرض می‌گیرد (سناریوی ساده).';
  if (hasLocal) return 'فقط مغز محلی — همه‌ی ناوگان از مغزِ محلی لیدر قرض می‌گیرد (حریم‌داده حداکثری).';
  return 'هیچ مغزی وصل نیست — فقط پاسخ‌های قطعیِ بدون-مدل کار می‌کنند.';
}
