import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';
import { InProcessAgentEventBus } from '../orchestrator/agent-event-bus';

/**
 * P4-T5: usage metering. EVERY paid AI call pays toll through a
 * UsageMeterService.record — you'd never know the bill from logs alone.
 * Records are per (feature, model, UTC-month), rolled as aggregates (never
 * per-call row flooding) with `requests` + `tokens` + est. USD cost.
 * Pricing from `AI_TOKEN_PRICING_USD` (JSON map model→usd-per-1k-tokens);
 * missing price = cost reported `null` honestly rather than invented.
 *
 * Alert: when a month's total crosses `AI_MONTHLY_ALERT_THRESH_USD`, the
 * bus fires `usage.alerted` ONCE (re-armed daily) — the dashboard surfaces
 * it; there is no hidden spend.
 */

export interface UsageRecord {
  monthKey: string; // YYYY-MM
  feature: string;
  model: string;
  requests: number;
  tokens: number;
  costUsd: number | null;
  lastAt: string;
}

export interface MonthlyReport {
  month: string;
  features: UsageRecord[];
  totals: { requests: number; tokens: number; costUsd: number | null };
  alerted: number | null;
}

interface MeterState {
  records: UsageRecord[];
  alertedAt: string | null;
}

@Injectable()
export class UsageMeterService {
  private readonly logger = new Logger(UsageMeterService.name);
  private state: MeterState = { records: [], alertedAt: null };
  private loaded = false;

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly config: ConfigService,
    @Optional() private readonly bus?: InProcessAgentEventBus,
  ) {}

  private monthKey(): string {
    return new Date().toISOString().slice(0, 7);
  }

  private key(): string {
    return `runtime/usage/${this.monthKey()}.json`;
  }

  private pricing(): Record<string, number> {
    try {
      return JSON.parse(this.config.get<string>('AI_TOKEN_PRICING_USD') ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  }

  private async ensure(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.storage.get(this.key());
      this.state = JSON.parse(raw.toString('utf8')) as MeterState;
    } catch {
      this.state = { records: [], alertedAt: null };
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.storage.put({
      key: this.key(),
      content: Buffer.from(JSON.stringify(this.state)),
      contentType: 'application/json',
      metadata: { kind: 'usage' },
    });
  }

  /** The API every AI caller must pass through — deterministic rollup,
   *  never invented totals. */
  async recordCall(input: {
    feature: string;
    model: string;
    usage?: { totalTokens?: number };
    userId?: string;
  }): Promise<UsageRecord> {
    await this.ensure();
    const tokens = input.usage?.totalTokens ?? 0;
    const price = this.pricing()[input.model];
    const costUsd = price !== undefined ? (tokens / 1000) * price : null;

    const month = this.monthKey();
    let row = this.state.records.find((r) => r.monthKey === month && r.feature === input.feature && r.model === input.model);
    if (!row) {
      row = { monthKey: month, feature: input.feature, model: input.model, requests: 0, tokens: 0, costUsd: 0, lastAt: '' };
      this.state.records.push(row);
    }
    row.requests += 1;
    row.tokens += tokens;
    row.costUsd = (row.costUsd ?? 0) + (costUsd ?? 0);
    row.lastAt = new Date().toISOString();

    await this.persist();
    await this.maybeAlert();
    return { ...row };
  }

  private async maybeAlert(): Promise<void> {
    const thresholdRaw = this.config.get<string>('AI_MONTHLY_ALERT_THRESH_USD');
    if (!thresholdRaw) return;
    const threshold = Number(thresholdRaw);
    if (!Number.isFinite(threshold) || threshold <= 0) return;

    const month = this.monthKey();
    const total = this.state.records
      .filter((r) => r.monthKey === month && r.costUsd !== null)
      .reduce((s, r) => s + (r.costUsd ?? 0), 0);
    if (total < threshold) return;

    const today = new Date().toISOString().slice(0, 10);
    if (this.state.alertedAt?.slice(0, 10) === today) return; // at most once per day
    this.state.alertedAt = new Date().toISOString();
    await this.persist();
    this.logger.warn(`monthly alert: ${month} already ${total.toFixed(4)} USD ≥ ${threshold}`);
    this.bus?.emit({
      kind: 'usage.alerted',
      at: new Date().toISOString(),
      taskId: `usage-${month}`,
      agentId: 'legal-leader',
      detail: `harm ${total.toFixed(2)} USD crosses ${threshold} USD, month ${month}`,
    });
  }

  async monthlyReport(month?: string): Promise<MonthlyReport> {
    await this.ensure();
    const m = month ?? this.monthKey();
    const features = this.state.records.filter((r) => r.monthKey === m);
    const all = this.state.records
      .filter((r) => r.monthKey === m && r.costUsd !== null)
      .reduce((s, r) => s + (r.costUsd ?? 0), 0);
    const anyUnpriced = this.state.records.some((r) => r.monthKey === m);
    return {
      month: m,
      features,
      totals: {
        requests: features.reduce((s, r) => s + r.requests, 0),
        tokens: features.reduce((s, r) => s + r.tokens, 0),
        costUsd: anyUnpriced ? all : null,
      },
      alerted: this.state.alertedAt && this.state.alertedAt.slice(0, 7) === m ? 1 : null,
    };
  }

  /** Alert arming state — visible, nothing magical resets it silently. */
  async alertState(): Promise<{ monthKey: string; alertedAt: string | null }> {
    await this.ensure();
    return { monthKey: this.monthKey(), alertedAt: this.state.alertedAt };
  }
}
