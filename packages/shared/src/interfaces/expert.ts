import type { AgentResult, AgentTask, IAgent } from './agent';

/**
 * A specialized expert in the tree (apps/agents/{branch}). The `field` is the
 * primary routing dimension; orchestrator walks the tree by field, then picks
 * the highest-scoring skill inside the winning agent.
 */
export interface IExpertAgent extends IAgent {
  readonly kind: 'expert';
  /** One of the values of domain's LegalField (imported loosely to keep this
   *  package dependency-free; validated at registration time). */
  readonly field: string;
  /** Sub-specialization, e.g. 'contracts', 'custody'. Empty = whole field. */
  readonly subspecialties: readonly string[];
  /** Fleet-card persona for the dashboard (displayName, motto). Optional. */
  readonly persona?: { displayName: string; motto: string };
  /**
   * Whether this expert's answers may bypass lawyer review. Only true for
   * clearly-annotated informational skills; drafts must say false (SPEC §9).
   */
  readonly requiresReview: boolean;
  /** Deep route: field then skill. Returns null when no skill clears minScore. */
  route(
    task: Pick<AgentTask, 'query'>,
    minScore?: number,
  ): Promise<{ skillId: string; score: number } | null>;
  executeExpert(task: AgentTask): Promise<AgentResult>;
}
