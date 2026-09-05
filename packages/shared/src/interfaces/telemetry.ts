/**
 * Live ops telemetry (ADR-006): every step an agent takes is emitted as a
 * typed event; the dashboard streams these so the lawyer WATCHES the answer
 * being assembled ("پخت‌وپز") — transparent kitchen, not a black box.
 * In-process pub/sub now; Redis pub/sub swap-out planned (roadmap P5) so the
 * event shape must stay serializable (no class instances, no functions).
 */

export type AgentEventKind =
  | 'task.accepted'
  | 'task.classified'
  | 'task.routed'
  | 'inference.decided'
  | 'skill.started'
  | 'skill.completed'
  | 'task.failed'
  | 'task.completed'
  | 'grant.issued'
  | 'grant.revoked'
  | 'model.assigned'
  | 'model.unassigned'
  | 'file.uploaded'
  | 'file.analyzed'
  | 'conversation.turn'
  | 'queue.updated'
  | 'corpus.ingested'
  | 'corpus.validated';

export interface AgentEvent {
  kind: AgentEventKind;
  at: string; // ISO
  taskId: string;
  agentId: string | null;
  /** present on inference.decided */
  modelTarget?: 'local' | 'cloud';
  /** concrete model that served (or will serve) the task */
  model?: string;
  /** who decided the placement: operator pin, or the Leader sharing its API */
  assignmentSource?: 'manual' | 'leader_fallback' | 'policy_direct';
  /** token spend so far, when known */
  tokensUsed?: number;
  /** redacted, dashboard-safe detail — never raw client text beyond preview */
  detail?: string;
  durationMs?: number;
}

/** Port: orchestrator publishes, SSE controller subscribes. */
export interface AgentEventBus {
  emit(event: AgentEvent): void;
  subscribe(listener: (event: AgentEvent) => void): () => void;
  /** bounded ring buffer for the dashboard's initial paint */
  recent(limit: number): readonly AgentEvent[];
}
