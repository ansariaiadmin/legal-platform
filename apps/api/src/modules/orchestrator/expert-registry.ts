import { Injectable } from '@nestjs/common';
import type { IExpertAgent } from '@legal-platform/shared';

/**
 * Expert registry — the orchestrator's map of the tree (SPEC §11a).
 * Phase 0/1: static in-memory registration at bootstrap (agents are compiled
 * into the monolith). P1-T6 pins this interface so Phase 5 can swap in a
 * DB-backed registry (remote/enableable agents) without callers noticing —
 * that's why consumers depend on this class, not on a global list (§12: no
 * global mutable state).
 */
@Injectable()
export class ExpertRegistry {
  private readonly experts = new Map<string, IExpertAgent>();

  register(agent: IExpertAgent): void {
    if (this.experts.has(agent.agentId)) {
      throw new Error(`duplicate expert registration: ${agent.agentId}`);
    }
    this.experts.set(agent.agentId, agent);
  }

  get(agentId: string): IExpertAgent | undefined {
    return this.experts.get(agentId);
  }

  /** All registered experts grouped by legal field — shape the UI needs. */
  describeTree(): Array<{ field: string; agents: string[] }> {
    const byField = new Map<string, string[]>();
    for (const agent of this.experts.values()) {
      const list = byField.get(agent.field) ?? [];
      list.push(agent.agentId);
      byField.set(agent.field, list);
    }
    return [...byField.entries()].map(([field, agents]) => ({ field, agents }));
  }

  list(): IExpertAgent[] {
    return [...this.experts.values()];
  }
}
