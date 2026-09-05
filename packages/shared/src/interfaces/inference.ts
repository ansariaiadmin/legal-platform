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
  /** Signals that drove the choice — shown live in the dashboard. */
  signals: {
    localHealthy: boolean;
    budgetRemainingUsd: number | null;
    taskSensitivity: 'privileged' | 'normal';
  };
}

/** Port implemented in apps/api (it knows provider health + budget). */
export interface InferenceRouter {
  decide(input: {
    taskSensitivity?: 'privileged' | 'normal';
    estimatedTokens?: number;
  }): Promise<InferenceDecision>;
}
