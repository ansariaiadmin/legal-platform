import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  HybridPolicy,
  InferenceDecision,
  InferenceRouter,
} from '@legal-platform/shared';
import { AgentTier } from '@legal-platform/domain';

export const HYBRID_POLICY_ENV = 'AI_HYBRID_POLICY';
export const LOCAL_MODEL_URL_ENV = 'AI_LOCAL_BASE_URL';

const DEFAULT_POLICY: HybridPolicy = 'hybrid_local_first';

/**
 * Hybrid local/cloud inference router (ADR-004, SPEC §11a).
 *
 * Decision order is deliberately boring and deterministic (ADR-003):
 *   1. explicit policy pins (local_only / cloud_only) win immediately
 *   2. privileged tasks NEVER leave the box → local (§9 privacy)
 *   3. unhealthy local endpoint demotes hybrid to cloud
 *   4. exhausted budget promotes hybrid to local (cheap path)
 * Anything an operator overrides in the dashboard wins over all of it.
 */
@Injectable()
export class HybridInferenceRouter implements InferenceRouter {
  /** NOTE: AIProvider is intentionally NOT injected here — routing decisions
   *  are side-effect-free health/config reads (ADR-003). The actual model call
   *  through `providers/ai` happens at execution time, not decision time. */
  constructor(private readonly config: ConfigService) {}

  currentPolicy(): HybridPolicy {
    const fromEnv = this.config.get<string>(HYBRID_POLICY_ENV);
    if (
      fromEnv === 'local_only' ||
      fromEnv === 'cloud_only' ||
      fromEnv === 'hybrid_local_first' ||
      fromEnv === 'hybrid_cloud_first'
    ) {
      return fromEnv;
    }
    // Tier default (docs/AGENT_FLEET.md presets): spartan local-first,
    // senator cloud-first. counsel rides the middle.
    const tier = this.config.get<string>('AGENT_TIER');
    if (tier === AgentTier.SENATOR) return 'hybrid_cloud_first';
    return DEFAULT_POLICY;
  }

  private tier(): AgentTier {
    const t = this.config.get<string>('AGENT_TIER');
    return t === AgentTier.COUNSEL || t === AgentTier.SENATOR ? t : AgentTier.SPARTAN;
  }

  async decide(input: {
    taskSensitivity?: 'privileged' | 'normal';
    estimatedTokens?: number;
  }): Promise<InferenceDecision> {
    const policy = this.currentPolicy();
    const localUrl = this.config.get<string>(LOCAL_MODEL_URL_ENV);
    const localHealthy = await this.probeLocal();
    const budgetRemainingUsd = this.readBudget();
    const taskSensitivity = input.taskSensitivity ?? 'normal';

    const base = {
      policy,
      signals: { localHealthy, budgetRemainingUsd, taskSensitivity },
    };

    if (policy === 'local_only') {
      return { ...base, target: 'local', reason: 'policy_pinned_local' };
    }
    if (policy === 'cloud_only') {
      return { ...base, target: 'cloud', reason: 'policy_pinned_cloud' };
    }
    if (taskSensitivity === 'privileged') {
      // Client-privileged matter data never leaves the deployment (SPEC §9).
      return localHealthy
        ? { ...base, target: 'local', reason: 'privileged_data' }
        : { ...base, target: 'local', reason: 'privileged_data_local_degraded' };
    }
    const budgetGone = budgetRemainingUsd !== null && budgetRemainingUsd <= 0;
    if (policy === 'hybrid_local_first') {
      if (!localUrl || !localHealthy) {
        return budgetGone
          ? { ...base, target: 'local', reason: 'local_down_and_budget_gone' }
          : { ...base, target: 'cloud', reason: 'local_down' };
      }
      return budgetGone
        ? { ...base, target: 'local', reason: 'budget_exhausted' }
        : { ...base, target: 'local', reason: 'policy_local_first' };
    }
    // hybrid_cloud_first
    if (budgetGone) return { ...base, target: 'local', reason: 'budget_exhausted' };
    return localHealthy
      ? { ...base, target: 'cloud', reason: 'policy_cloud_first' }
      : { ...base, target: 'cloud', reason: 'cloud_preferred_local_degraded' };
  }

  /** Local model probe. Honest failure: no healthy local => reported as such. */
  private async probeLocal(): Promise<boolean> {
    const url = this.config.get<string>(LOCAL_MODEL_URL_ENV);
    if (!url) return false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${url}/health`, { signal: controller.signal });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Monthly AI budget envelope; null = unmetered. Wires to usage_records in P4-T5. */
  private readBudget(): number | null {
    const raw = this.config.get<string>('AI_MONTHLY_BUDGET_USD');
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  describe() {
    return {
      tier: this.tier(),
      policy: this.currentPolicy(),
      localBaseUrlConfigured: Boolean(this.config.get<string>(LOCAL_MODEL_URL_ENV)),
    };
  }
}
