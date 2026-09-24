import { MetricsAggregatorService } from '../../src/modules/orchestrator/metrics-aggregator.service';
import { EvaluatorService } from '../../src/modules/orchestrator/evaluator.service';
import { InProcessAgentEventBus } from '../../src/modules/orchestrator/agent-event-bus';
import type { AgentEvent } from '@legal-platform/shared';

function emitTask(bus: InProcessAgentEventBus, taskId: string, agentId: string, durationMs: number, score = 0.7) {
  const events: AgentEvent[] = [
    { kind: 'task.accepted', at: '', taskId, agentId: null },
    { kind: 'task.classified', at: '', taskId, agentId: null },
    { kind: 'task.routed', at: '', taskId, agentId, detail: `skill=s score=${score}` },
    { kind: 'inference.decided', at: '', taskId, agentId, modelTarget: 'local' },
    { kind: 'skill.started', at: '', taskId, agentId },
    { kind: 'task.completed', at: '', taskId, agentId, durationMs },
  ];
  for (const e of events) bus.emit(e);
}

describe('MetricsAggregatorService + EvaluatorService (ADR-008)', () => {
  it('aggregates live per-agent stats from the event stream', () => {
    const bus = new InProcessAgentEventBus();
    const metrics = new MetricsAggregatorService(bus);
    metrics.onModuleInit();

    emitTask(bus, 't1', 'civil-expert', 100);
    emitTask(bus, 't2', 'civil-expert', 300);

    const row = metrics.snapshot().find((m) => m.agentId === 'civil-expert')!;
    expect(row.completed).toBe(2);
    expect(row.avgDurationMs).toBe(200);
    expect(row.successRate).toBe(1);
    expect(row.localRuns).toBe(2);
  });

  it('attributes governance denials to the agent', () => {
    const bus = new InProcessAgentEventBus();
    const metrics = new MetricsAggregatorService(bus);
    metrics.onModuleInit();

    bus.emit({ kind: 'task.failed', at: '', taskId: 't9', agentId: 'civil-expert', detail: 'governance_denied:no_grant' });

    const row = metrics.snapshot().find((m) => m.agentId === 'civil-expert')!;
    expect(row.denials).toBe(1);
  });

  it('evaluator flags unrouted failures as spawn_role suggestion', () => {
    const metrics = [{
      agentId: 'unrouted', accepted: 0, completed: 0, failed: 7,
      successRate: null, avgDurationMs: null, avgRouteScore: null,
      localRuns: 0, cloudRuns: 0, denials: 0,
    }];
    const suggestions = new EvaluatorService().evaluate(metrics);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].kind).toBe('spawn_role');
    expect(suggestions[0].summaryFa).toContain('نقش جدیدی');
  });

  it('evaluator holds judgment below MIN_SAMPLE (no anecdote-based verdicts)', () => {
    const sparse = [{
      agentId: 'civil-expert', accepted: 2, completed: 1, failed: 2,
      successRate: 1 / 3, avgDurationMs: 5000, avgRouteScore: 0.2,
      localRuns: 0, cloudRuns: 0, denials: 2,
    }];
    expect(new EvaluatorService().evaluate(sparse)).toHaveLength(0);
  });

  it('evaluator ranks low successRate as review_grants with high confidence', () => {
    const row = {
      agentId: 'family-expert', accepted: 10, completed: 3, failed: 7,
      successRate: 0.3, avgDurationMs: 800, avgRouteScore: 0.8,
      localRuns: 5, cloudRuns: 5, denials: 6,
    };
    const suggestions = new EvaluatorService().evaluate([row]);
    expect(suggestions[0].kind).toBe('review_grants');
    expect(suggestions[0].agentId).toBe('family-expert');
  });

  it('evaluator suggests hybrid tuning for slow, cloud-heavy agents', () => {
    const row = {
      agentId: 'civil-expert', accepted: 10, completed: 10, failed: 0,
      successRate: 1, avgDurationMs: 3000, avgRouteScore: 0.8,
      localRuns: 1, cloudRuns: 9, denials: 0,
    };
    const suggestions = new EvaluatorService().evaluate([row]);
    expect(suggestions.some((s) => s.kind === 'tune_hybrid_policy')).toBe(true);
  });
});
