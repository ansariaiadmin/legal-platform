import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  HybridPolicy,
  InferenceDecision,
  InferenceRouter,
} from '@legal-platform/shared';
import { AgentTier } from '@legal-platform/domain';
import { ModelAssignmentService } from './model-assignment.service';
import { ConfigHubService } from './config-hub.service';

export const HYBRID_POLICY_ENV = 'AI_HYBRID_POLICY';
export const LOCAL_MODEL_URL_ENV = 'AI_LOCAL_BASE_URL';
export const CLOUD_MODEL_ENV = 'AI_CLOUD_MODEL';
export const LOCAL_MODEL_ENV = 'AI_LOCAL_MODEL';

const DEFAULT_POLICY: HybridPolicy = 'hybrid_local_first';

type DecisionInput = {
  taskSensitivity?: 'privileged' | 'normal';
  estimatedTokens?: number;
  /** required for the manual-assignment layer (ADR-011) */
  agentId?: string;
};

/**
 * Hybrid local/cloud inference router (ADR-004 + ADR-011), three layers in
 * strict precedence:
 *
 *   1. **Secrecy law.** Privileged tasks NEVER go to cloud — beats even a
 *      manual cloud assignment (the operator is protected from their own
 *      misconfig; the live stream records the override).
 *   2. **Manual pin.** Manager assigned a model to the agent → honored.
 *   3. **Leader lending.** Nothing pinned → the agent runs on the Leader's
 *      own configured API (cloud gateway or local box) with provenance marked
 *      `assignmentSource='leader_fallback'`, and the dashboard shows it.
 *
 * NOTE: AIProvider is intentionally NOT injected here — routing decisions are
 * side-effect-free health/config reads (ADR-003). The actual model call
 * through `providers/ai` happens at execution time, not decision time.
 */
@Injectable()
export class HybridInferenceRouter implements InferenceRouter {
  constructor(
    private readonly config: ConfigService,
    private readonly assignments: ModelAssignmentService,
    /** dashboard-set brain overrides (ADR-014) beat env, secrecy law still wins */
    @Optional() private readonly configHub?: ConfigHubService,
    /** test seam — constructor injection keeps unit tests hermetic */
  ) {}

  currentPolicy(): HybridPolicy {
    const preset = this.configHub?.peek().preset;
    if (preset) {
      if (preset === 'senator') return 'hybrid_cloud_first';
      if (preset === 'counsel') return 'hybrid_local_first';
      return 'local_only';
    }
    const fromEnv = this.config.get<string>(HYBRID_POLICY_ENV);
    if (
      (fromEnv === 'local_only' ||
        fromEnv === 'cloud_only' ||
        fromEnv === 'hybrid_local_first' ||
        fromEnv === 'hybrid_cloud_first') &&
      !preset
    ) {
      return fromEnv;
    }
    // Tier default (docs/AGENT_FLEET.md presets): spartan local-first,
    // senator cloud-first; counsel rides the middle.
    const tier = this.config.get<string>('AGENT_TIER');
    if (tier === AgentTier.SENATOR) return 'hybrid_cloud_first';
    return DEFAULT_POLICY;
  }

  private tier(): AgentTier {
    const t = this.config.get<string>('AGENT_TIER');
    return t === AgentTier.COUNSEL || t === AgentTier.SENATOR ? t : AgentTier.SPARTAN;
  }

  async decide(input: DecisionInput): Promise<InferenceDecision> {
    const policy = this.currentPolicy();
    const hubLocal = this.configHub?.peek().local;
    const localUrl = hubLocal?.baseUrl ?? this.config.get<string>(LOCAL_MODEL_URL_ENV);
    const localHealthy = await this.probeLocal();
    const budgetRemainingUsd = this.readBudget();
    const taskSensitivity = input.taskSensitivity ?? 'normal';

    const base = {
      policy,
      signals: { localHealthy, budgetRemainingUsd, taskSensitivity },
    };
    const assignment = input.agentId ? this.assignments.get(input.agentId) : undefined;

    // ---- Layer 1: secrecy beats everything --------------------------------
    if (taskSensitivity === 'privileged') {
      return localHealthy
        ? {
            ...base,
            target: 'local',
            model: assignment?.target === 'local' ? assignment.model : this.localModel(),
            assignmentSource: assignment?.target === 'local' ? 'manual' : undefined,
            reason: assignment?.target === 'cloud' ? 'privileged_overrides_manual_pin' : 'privileged_data',
          }
        : {
            ...base,
            target: 'local',
            model: this.localModel(),
            assignmentSource: undefined,
            reason:
              assignment?.target === 'cloud'
                ? 'privileged_overrides_manual_pin_local_degraded'
                : 'privileged_data_local_degraded',
          };
    }

    // ---- Layer 2: manual pin honored (post-secrecy) -----------------------
    if (assignment) {
      if (assignment.target === 'local' && !localHealthy) {
        return {
          ...base,
          target: 'local',
          model: assignment.model,
          assignmentSource: 'manual',
          reason: 'manual_pin_local_degraded',
        };
      }
      return {
        ...base,
        target: assignment.target,
        model: assignment.model,
        assignmentSource: 'manual',
        reason: 'manual_pin',
      };
    }

    // ---- Layer 3: no pin → the Leader lends its own API -------------------
    const budgetGone = budgetRemainingUsd !== null && budgetRemainingUsd <= 0;
    const lendCloud = (reason: string): InferenceDecision => ({
      ...base,
      target: 'cloud',
      model: this.cloudModel(),
      assignmentSource: 'leader_fallback',
      reason,
    });
    const lendLocal = (reason: string): InferenceDecision => ({
      ...base,
      target: 'local',
      model: this.localModel(),
      assignmentSource: 'leader_fallback',
      reason,
    });

    if (policy === 'local_only') return lendLocal('policy_pinned_local');
    if (policy === 'cloud_only') return lendCloud('policy_pinned_cloud');

    if (policy === 'hybrid_local_first') {
      if (!localUrl || !localHealthy) {
        return budgetGone ? lendLocal('local_down_and_budget_gone') : lendCloud('local_down');
      }
      return budgetGone ? lendLocal('budget_exhausted') : lendLocal('policy_local_first');
    }
    // hybrid_cloud_first
    if (budgetGone) return lendLocal('budget_exhausted');
    return lendCloud(localHealthy ? 'policy_cloud_first' : 'cloud_preferred_local_degraded');
  }

  /** Local model probe. Honest failure: no healthy local => reported as such. */
  private async probeLocal(): Promise<boolean> {
    const url = this.configHub?.peek().local?.baseUrl ?? this.config.get<string>(LOCAL_MODEL_URL_ENV);
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

  private cloudModel(): string {
    return this.configHub?.peek().cloud?.model || this.config.get<string>(CLOUD_MODEL_ENV) || 'leader-gateway-default';
  }

  private localModel(): string {
    return this.configHub?.peek().local?.model || this.config.get<string>(LOCAL_MODEL_ENV) || 'local-box-default';
  }

  describe() {
    return {
      tier: this.tier(),
      policy: this.currentPolicy(),
      localBaseUrlConfigured: Boolean(this.config.get<string>(LOCAL_MODEL_URL_ENV)),
      cloudGatewayConfigured: Boolean(this.config.get<string>('AI_BASE_URL')),
      leaderDefaultModels: { cloud: this.cloudModel(), local: this.localModel() },
    };
  }
}
