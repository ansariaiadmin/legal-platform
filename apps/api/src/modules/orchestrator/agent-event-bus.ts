import { Injectable } from '@nestjs/common';
import type { AgentEvent, AgentEventBus } from '@legal-platform/shared';

const RING_LIMIT = 200;

/**
 * In-process event bus (ADR-006). Serializable events only so this can move
 * to Redis pub/sub without shape changes (roadmap P5-T2). The ring buffer
 * backs the dashboard's initial paint; live deltas stream over SSE.
 */
@Injectable()
export class InProcessAgentEventBus implements AgentEventBus {
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private readonly ring: AgentEvent[] = [];

  emit(event: AgentEvent): void {
    this.ring.push(event);
    if (this.ring.length > RING_LIMIT) this.ring.shift();
    for (const listener of this.listeners) listener(event);
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recent(limit: number): readonly AgentEvent[] {
    return this.ring.slice(-limit);
  }
}
