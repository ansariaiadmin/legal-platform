import { Injectable, Logger } from '@nestjs/common';
import type { AgentEvent, AgentTask } from '@legal-platform/shared';
import { LegalField } from '@legal-platform/domain';
import { ERROR_CODES } from '@legal-platform/contracts';
import { ExpertRegistry } from './expert-registry';
import { IntentClassifier, LOW_CONFIDENCE, type IntentClassification } from './intent-classifier';
import { HybridInferenceRouter } from './hybrid-inference-router';
import { AgentGovernanceService } from './agent-governance.service';
import { InProcessAgentEventBus } from './agent-event-bus';

export interface RouteResult {
  agentId: string | null;
  skillId: string | null;
  score: number;
  classification: IntentClassification;
  /** true when deterministic confidence was low (ADR-003); P3 wires the LLM
   *  tiebreaker behind the AI provider — never outside it (§8). */
  needsLlmTiebreak: boolean;
}

function redact(query: string): string {
  const head = query.replace(/\s+/g, ' ').trim();
  return head.length > 60 ? `${head.slice(0, 60)}…` : head;
}

/**
 * Orchestrator — The Leader (SPEC §11a pillar 3).
 *
 * Every dispatch passes three gates, in order, each one emitting a live event
 * so the dashboard watches the pipeline work (ADR-006):
 *   route  — deterministic tree walk (ADR-003)
 *   grant  — governed agents need an active capability grant (ADR-005)
 *   infer  — hybrid local/cloud decision (ADR-004)
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly registry: ExpertRegistry,
    private readonly governance: AgentGovernanceService,
    private readonly inferenceRouter: HybridInferenceRouter,
    private readonly bus: InProcessAgentEventBus,
    private readonly classifier: IntentClassifier = new IntentClassifier(),
  ) {}

  private emit(event: Omit<AgentEvent, 'at'>): void {
    this.bus.emit({ ...event, at: new Date().toISOString() });
  }

  async route(query: string, taskId = 'route-only'): Promise<RouteResult> {
    const classification = this.classifier.classify(query);
    this.emit({
      kind: 'task.classified',
      taskId,
      agentId: null,
      detail: `field=${classification.field} kind=${classification.kind} confidence=${classification.confidence.toFixed(2)}`,
    });

    const scoped = this.registry
      .list()
      .filter((a) => a.field === classification.field || a.field === LegalField.GENERAL)
      .filter((a) => !this.governance.isDisabled(a.agentId));

    let best: RouteResult | null = null;
    for (const agent of scoped) {
      // Unhealthy OR disabled agents are skipped, not fatal (SPEC §2).
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

    const result =
      best ?? {
        agentId: null,
        skillId: null,
        score: 0,
        classification,
        needsLlmTiebreak: classification.confidence < LOW_CONFIDENCE,
      };
    this.emit({
      kind: 'task.routed',
      taskId,
      agentId: result.agentId,
      detail: result.skillId ? `skill=${result.skillId} score=${result.score.toFixed(2)}` : 'no expert matched',
    });
    return result;
  }

  /** Route AND execute behind the governance + inference gates. */
  async dispatch(task: AgentTask) {
    const started = Date.now();
    this.emit({ kind: 'task.accepted', taskId: task.taskId, agentId: null, detail: redact(task.query) });

    const routing = await this.route(task.query, task.taskId);
    if (!routing.agentId) {
      this.emit({ kind: 'task.failed', taskId: task.taskId, agentId: null, detail: 'no_route' });
      return {
        routing,
        inference: null,
        result: {
          ok: false,
          output: 'هیچ کارشناسی برای این پرسش پیدا نشد.',
          errorCode: ERROR_CODES.AI_NO_EXPERT_MATCHED,
        },
      };
    }

    // Gate 2 — governance. The Leader's grants are the ONLY authority (ADR-005).
    const capability = `expert:${routing.classification.field}:execute`;
    const decision = await this.governance.check(routing.agentId, capability);
    if (!decision.allowed) {
      this.emit({
        kind: 'task.failed',
        taskId: task.taskId,
        agentId: routing.agentId,
        detail: `governance_denied:${decision.reason}`,
      });
      return {
        routing,
        inference: null,
        result: {
          ok: false,
          output: 'این دست‌یار در حال حاضر مجوز اجرا ندارد؛ از داشبورد مجوز صادر کنید.',
          errorCode: ERROR_CODES.AI_AGENT_NOT_AUTHORIZED,
          meta: { governanceReason: decision.reason },
        },
      };
    }

    // Gate 3 — hybrid inference placement (ADR-004/011). The router knows the
    // agentId, so a manual pin wins; otherwise the Leader lends its own API
    // and the dashboard sees `assignmentSource` either way.
    const inference = await this.inferenceRouter.decide({
      taskSensitivity: task.sensitivity ?? 'normal',
      estimatedTokens: task.budget?.maxTokens,
      agentId: routing.agentId,
    });
    this.emit({
      kind: 'inference.decided',
      taskId: task.taskId,
      agentId: routing.agentId,
      modelTarget: inference.target,
      model: inference.model,
      assignmentSource: inference.assignmentSource,
      detail: inference.reason,
    });

    const agent = this.registry.get(routing.agentId)!;
    this.emit({ kind: 'skill.started', taskId: task.taskId, agentId: routing.agentId, detail: routing.skillId! });
    const result = await agent.executeExpert(task);
    this.emit({
      kind: result.ok ? 'task.completed' : 'task.failed',
      taskId: task.taskId,
      agentId: routing.agentId,
      durationMs: Date.now() - started,
    });
    this.logger.log(
      `dispatched task=${task.taskId} → ${routing.agentId}/${routing.skillId} via ${inference.target} (${inference.reason})`,
    );
    return {
      routing,
      inference,
      result: { ...result, meta: { ...result.meta, grantId: decision.grant.grantId } },
    };
  }

  getTree() {
    return this.registry.describeTree();
  }
}
