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

  /** Only the Evolution service calls this, and only for its own spawned
   *  members (`-spawned` version suffix); core fleet members cannot be
   *  removed at runtime. (ADR-009) */
  remove(agentId: string): boolean {
    const agent = this.experts.get(agentId);
    if (!agent || !agent.version.endsWith('-spawned')) return false;
    return this.experts.delete(agentId);
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

  /** Fleet cards for the dashboard: identity, persona, live health. The
   *  dashboard paints WHO the society members are from this alone. */
  async describeFleet(): Promise<
    Array<{
      agentId: string;
      field: string;
      version: string;
      persona: string;
      personaEn?: string | null;
      mottoEn?: string | null;
      motto: string;
      skills: string[];
      healthy: boolean;
      requiresReview: boolean;
      kind: string;
    }>
  > {
    const cards = [];
    for (const agent of this.experts.values()) {
      const health = await agent.health().catch(() => ({ healthy: false as const }));
      cards.push({
        agentId: agent.agentId,
        field: agent.field,
        version: agent.version,
        persona: agent.persona?.displayName ?? agent.agentId,
        motto: agent.persona?.motto ?? '',
        // P7 bilingual fleet cards — UI picks by active locale
        personaEn: agent.persona?.displayNameEn ?? null,
        mottoEn: agent.persona?.mottoEn ?? null,
        skills: agent.capabilities().map((s) => s.id),
        healthy: health.healthy,
        requiresReview: agent.requiresReview,
        kind: agent.kind,
      });
    }
    return cards;
  }
}
