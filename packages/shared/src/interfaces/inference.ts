/**
 * Hybrid inference routing (ADR-004): every agent call chooses local or cloud
 * deliberately, never by accident. The decision, its inputs and its reason are
 * returned to the caller and emitted to the live ops stream so the dashboard
 * shows exactly where each answer was "cooked".
 */

export type ModelTarget = 'local' | 'cloud';

export type HybridPolicy =
  /** Everything local; cloud never touched (offline / max privacy). */
  | 'local_only'
  /** Everything cloud (no local GPU on this box). */
  | 'cloud_only'
  /** Prefer local, fall back to cloud on overload/failure. */
  | 'hybrid_local_first'
  /** Prefer cloud quality, fall back to local when budget/quota is gone. */
  | 'hybrid_cloud_first';

export interface InferenceDecision {
  target: ModelTarget;
  /** Human/machine reason code, e.g. 'budget_exhausted', 'local_down'. */
  reason: string;
  policy: HybridPolicy;
  /** Concrete model id that will serve, when known (assigned or default). */
  model?: string;
  /** Where the placement came from: owner pin, or the Leader sharing its API
   *  to an unassigned agent (SPEC §11a invariant v — lending, not gifting:
   *  provenance is ALWAYS recorded). */
  assignmentSource?: 'manual' | 'leader_fallback' | 'policy_direct';
  /** Signals that drove the choice — shown live in the dashboard. */
  signals: {
    localHealthy: boolean;
    budgetRemainingUsd: number | null;
    taskSensitivity: 'privileged' | 'normal';
  };
}

/** The Leader's per-agent model matrix (ADR-011). */
export interface ModelAssignment {
  agentId: string;
  target: ModelTarget;
  /** e.g. 'qwen2.5:14b-instruct' or 'gpt-4.1-mini' */
  model: string;
  assignedBy: string; // owner user id
  assignedAt: string; // ISO
}

/** Port implemented in apps/api (it knows provider health + budget). */
export interface InferenceRouter {
  decide(input: {
    taskSensitivity?: 'privileged' | 'normal';
    estimatedTokens?: number;
  }): Promise<InferenceDecision>;
}
