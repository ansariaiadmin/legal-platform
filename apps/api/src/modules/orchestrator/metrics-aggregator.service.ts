import { Injectable, OnModuleInit } from '@nestjs/common';
import type { AgentEvent } from '@legal-platform/shared';
import { InProcessAgentEventBus } from './agent-event-bus';

export interface AgentMetrics {
  agentId: string;
  accepted: number;
  completed: number;
  failed: number;
  /** success rate in [0,1] over completed+failed */
  successRate: number | null;
  /** avg dispatch latency of completed tasks, ms */
  avgDurationMs: number | null;
  /** avg routing score; low ⇒ vocabulary struggle (evaluator signal) */
  avgRouteScore: number | null;
  /** inference placements seen */
  localRuns: number;
  cloudRuns: number;
  /** governance denials attributed to this agentId */
  denials: number;
}

/**
 * Live fleet telemetry (ADR-008): consumes the event bus, keeps a per-agent
 * rolling view in memory. Moving to a time-series store later only changes
 * THIS file — evaluator consumes AgentMetrics, not the event store.
 */
@Injectable()
export class MetricsAggregatorService implements OnModuleInit {
  private readonly byAgent = new Map<string, {
    accepted: number; completed: number; failed: number;
    totalDurationMs: number; durations: number;
    scoreSum: number; scoredRoutes: number;
    local: number; cloud: number; denials: number;
  }>();
  private routedScore = new Map<string, { agentId: string; score: number }>();

  constructor(private readonly bus: InProcessAgentEventBus) {}

  onModuleInit(): void {
    this.bus.subscribe((e) => this.ingest(e));
  }

  private ensure(agentId: string) {
    let row = this.byAgent.get(agentId);
    if (!row) {
      row = {
        accepted: 0, completed: 0, failed: 0,
        totalDurationMs: 0, durations: 0, scoreSum: 0, scoredRoutes: 0,
        local: 0, cloud: 0, denials: 0,
      };
      this.byAgent.set(agentId, row);
    }
    return row;
  }

  private ingest(e: AgentEvent): void {
    switch (e.kind) {
      case 'task.accepted':
        break; // accepted is counted once routed to the winning agent below
      case 'task.routed': {
        if (e.agentId) {
          const scoreMatch = /score=([\d.]+)/.exec(e.detail ?? '');
          this.routedScore.set(e.taskId, {
            agentId: e.agentId,
            score: scoreMatch ? Number(scoreMatch[1]) : 0,
          });
          this.ensure(e.agentId).accepted += 1;
        }
        break;
      }
      case 'inference.decided': {
        if (e.agentId) {
          const row = this.ensure(e.agentId);
          if (e.modelTarget === 'local') row.local += 1;
          else row.cloud += 1;
        }
        break;
      }
      case 'task.completed': {
        if (!e.agentId) break;
        const row = this.ensure(e.agentId);
        row.completed += 1;
        if (typeof e.durationMs === 'number') {
          row.totalDurationMs += e.durationMs;
          row.durations += 1;
        }
        const r = this.routedScore.get(e.taskId);
        if (r && r.agentId === e.agentId) {
          row.scoreSum += r.score;
          row.scoredRoutes += 1;
          this.routedScore.delete(e.taskId);
        }
        break;
      }
      case 'task.failed': {
        const row = this.ensure(e.agentId ?? 'unrouted');
        row.failed += 1;
        if (e.detail?.startsWith('governance_denied:')) row.denials += 1;
        this.routedScore.delete(e.taskId);
        break;
      }
      default:
        break;
    }
  }

  snapshot(): AgentMetrics[] {
    return [...this.byAgent.entries()].map(([agentId, r]) => ({
      agentId,
      accepted: r.accepted,
      completed: r.completed,
      failed: r.failed,
      successRate:
        r.completed + r.failed > 0 ? r.completed / (r.completed + r.failed) : null,
      avgDurationMs: r.durations > 0 ? Math.round(r.totalDurationMs / r.durations) : null,
      avgRouteScore: r.scoredRoutes > 0 ? Number((r.scoreSum / r.scoredRoutes).toFixed(3)) : null,
      localRuns: r.local,
      cloudRuns: r.cloud,
      denials: r.denials,
    }));
  }
}
