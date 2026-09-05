/**
 * Agent DNA (SPEC §11a). Every agent in apps/agents/{branch} implements
 * IAgent; experts add IExpertAgent. Keep these interfaces dependency-free —
 * they must compile for api, web, workers and future platform-clients alike.
 */

/** What the orchestrator hands to an agent. Self-contained & traceable. */
export interface AgentTask {
  /** Correlation id; survives queues so a task is traceable end to end. */
  taskId: string;
  /** Persian or English free-text query (i18n of UI stays out of this layer). */
  query: string;
  /** Optional prior context (retrieved chunks, conversation memory refs). */
  context?: string[];
  /** Who asked — used for audit + budget attribution, never secrets. */
  requestedBy?: { userId: string; role: string };
  /** Deadlines/limits the agent must respect. */
  budget?: { maxTokens?: number; maxLatencyMs?: number };
}

export interface AgentResult {
  ok: boolean;
  /** Human-readable answer/draft. Persian default; language is caller's choice. */
  output: string;
  /** Grounding citations — REQUIRED for any draft-ish output (SPEC §9). */
  citations?: Array<{ text: string; sourceId: string; url?: string }>;
  /** Free-form metrics drawer (tokens, confidence, timings). */
  meta?: Record<string, unknown>;
  /** Machine error code from packages/contracts ERROR_CODES when !ok. */
  errorCode?: string;
}

/** A named capability an agent advertises; the tree routes on these. */
export interface ISkill {
  /** Stable, unique per agent, kebab-case, e.g. 'civil:contract-review'. */
  id: string;
  description: string;
  /**
   * Deterministic relevance score in [0,1] for routing. MUST be pure and
   * side-effect free — orchestrator calls it often and cheaply (ADR-003).
   */
  match(task: Pick<AgentTask, 'query'>): number;
}

export type AgentKind = 'expert' | 'collector' | 'validator' | 'updater';

/** The root contract. `capabilities()` is the legal equivalent of a class's
 *  public API — orchestrator + tests interrogate it, never guess. */
export interface IAgent {
  readonly agentId: string; // unique across the fleet, kebab-case
  readonly kind: AgentKind;
  readonly version: string; // semver of the agent itself
  capabilities(): readonly ISkill[];
  /** Liveness per SPEC §8: failing agents must not crash the platform. */
  health(): Promise<{ healthy: boolean; detail?: string }>;
  execute(task: AgentTask): Promise<AgentResult>;
}
