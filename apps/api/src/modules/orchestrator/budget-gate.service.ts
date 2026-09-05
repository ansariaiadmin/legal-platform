import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';

/**
 * P3-T4: per-feature quota gate. BEFORE any paid LLM call the caller asks
 * `check(feature)`; on exhausted quota the platform falls into
 * deterministic-only mode — a LAW (SPEC §9 layered), not a grudge. Spend is
 * recorded per (feature, day) through the StorageProvider so a restart
 * doesn't make spend fake-zero.
 *
 * Quota source: env `AI_FEATURE_QUOTA_TOKENS` as JSON map
 * `{"tiebreak": 50000, ...}` (default: everything wide-open in dev,
 * documented — production sets numbers).
 */

export interface FeatureBudget {
  feature: string;
  day: string; // YYYY-MM-DD UTC — slate resets each UTC day
  quotaTokens: number | null; // null = no cap configured
  spentTokens: number;
  exhausted: boolean;
}

@Injectable()
export class BudgetGateService {
  private readonly logger = new Logger(BudgetGateService.name);
  private readonly cache = new Map<string, { spent: number }>();
  private readonly quotas: Record<string, number>;

  constructor(
    private readonly config: ConfigService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {
    let raw = this.config.get<string>('AI_FEATURE_QUOTA_TOKENS') ?? '{}';
    try {
      this.quotas = JSON.parse(raw) as Record<string, number>;
    } catch {
      this.logger.warn('AI_FEATURE_QUOTA_TOKENS is not valid JSON — treating as unlimited');
      this.quotas = {};
    }
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private key(feature: string): string {
    return `runtime/budget/${feature}.${this.today()}.json`;
  }

  private async load(feature: string): Promise<{ spent: number }> {
    const hit = this.cache.get(feature);
    if (hit) return hit;
    try {
      const raw = await this.storage.get(this.key(feature));
      const parsed = JSON.parse(raw.toString('utf8')) as { spent: number };
      this.cache.set(feature, parsed);
      return parsed;
    } catch {
      const fresh = { spent: 0 };
      this.cache.set(feature, fresh);
      return fresh;
    }
  }

  async view(feature: string): Promise<FeatureBudget> {
    const quota = this.quotas[feature] ?? null;
    const { spent } = await this.load(feature);
    return {
      feature,
      day: this.today(),
      quotaTokens: quota,
      spentTokens: spent,
      exhausted: quota !== null && spent >= quota,
    };
  }

  /** True when this feature is still allowed its paid LLM calls. */
  async check(feature: string): Promise<boolean> {
    const b = await this.view(feature);
    return !b.exhausted;
  }

  /**
   * Pay for what the provider ACTUALLY said it spent. Zero/undefined usage
   * (mock adapters) increments nothing — spend bookkeeping is real or absent.
   */
  async consume(feature: string, usage?: { totalTokens?: number }): Promise<FeatureBudget> {
    const entry = await this.load(feature);
    const spent = usage?.totalTokens ?? 0;
    if (spent > 0) {
      entry.spent += spent;
      await this.storage.put({
        key: this.key(feature),
        content: Buffer.from(JSON.stringify(entry)),
        contentType: 'application/json',
        metadata: { kind: 'budget' },
      });
    }
    return this.view(feature);
  }

  async all(features: string[]): Promise<FeatureBudget[]> {
    return Promise.all(features.map((f) => this.view(f)));
  }
}
