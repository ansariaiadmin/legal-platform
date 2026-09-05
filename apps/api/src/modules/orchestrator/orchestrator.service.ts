import { Injectable, Logger } from '@nestjs/common';
import type { AgentTask } from '@legal-platform/shared';
import { LegalField } from '@legal-platform/domain';
import { ERROR_CODES } from '@legal-platform/contracts';
import { ExpertRegistry } from './expert-registry';
import { IntentClassifier, LOW_CONFIDENCE, type IntentClassification } from './intent-classifier';

export interface RouteResult {
  agentId: string | null;
  skillId: string | null;
  score: number;
  classification: IntentClassification;
  /** true when deterministic confidence was low (ADR-003); Phase 3 wires the
   *  LLM tie-breaker behind the AI provider, never outside it (§8). */
  needsLlmTiebreak: boolean;
}

/**
 * Orchestrator — The Leader (SPEC §11a pillar 3).
 *
 * Shortest-path routing through the Expert Tree: classify the query to a
 * legal field, restrict the walk to that field's agents, then pick the
 * highest-scoring skill. Deterministic first; LLM tiebreak is Phase 3 and
 * goes through `providers/ai` only.
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly registry: ExpertRegistry,
    private readonly classifier: IntentClassifier = new IntentClassifier(),
  ) {}

  async route(query: string): Promise<RouteResult> {
    const classification = this.classifier.classify(query);
    const scoped = this.registry
      .list()
      .filter((a) => a.field === classification.field || a.field === LegalField.GENERAL);

    let best: RouteResult | null = null;
    for (const agent of scoped) {
      // Unhealthy agents are skipped, not fatal (SPEC §2 failure domains).
      if (!(await agent.health()).healthy) continue;
      const r = await agent.route({ query });
      if (!r) continue;
      if (!best || r.score > best.score) {
        best = {
          agentId: agent.agentId,
          skillId: r.skillId,
          score: r.score,
          classification,
          needsLlmTiebreak: classification.confidence < LOW_CONFIDENCE,
        };
      }
    }

    return (
      best ?? {
        agentId: null,
        skillId: null,
        score: 0,
        classification,
        needsLlmTiebreak: classification.confidence < LOW_CONFIDENCE,
      }
    );
  }

  /** Route AND execute — Phase 0 proves the loop end to end. */
  async dispatch(task: AgentTask) {
    const routing = await this.route(task.query);
    if (!routing.agentId) {
      return {
        routing,
        result: {
          ok: false,
          output: 'هیچ کارشناسی برای این پرسش پیدا نشد.',
          errorCode: ERROR_CODES.AI_NO_EXPERT_MATCHED,
        },
      };
    }
    const agent = this.registry.get(routing.agentId)!;
    const result = await agent.executeExpert({
      ...task,
      requestedBy: task.requestedBy,
    });
    this.logger.log(`dispatched task=${task.taskId} → ${routing.agentId}/${routing.skillId}`);
    return { routing, result };
  }

  getTree() {
    return this.registry.describeTree();
  }
}
