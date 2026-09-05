import { Injectable } from '@nestjs/common';
import type { ModelAssignment, ModelTarget } from '@legal-platform/shared';

/**
 * Per-agent model matrix (ADR-011). What the dashboard edits: which agent
 * runs on which brain. In-memory per process (same fail-safe story as
 * grants — restarts reset, never silently resurrect; DB migration P5-T3).
 */
@Injectable()
export class ModelAssignmentService {
  private readonly assignments = new Map<string, ModelAssignment>();

  assign(agentId: string, target: ModelTarget, model: string, assignedBy: string): ModelAssignment {
    const a: ModelAssignment = {
      agentId,
      target,
      model,
      assignedBy,
      assignedAt: new Date().toISOString(),
    };
    this.assignments.set(agentId, a);
    return a;
  }

  unassign(agentId: string): boolean {
    return this.assignments.delete(agentId);
  }

  get(agentId: string): ModelAssignment | undefined {
    return this.assignments.get(agentId);
  }

  list(): readonly ModelAssignment[] {
    return [...this.assignments.values()];
  }
}
