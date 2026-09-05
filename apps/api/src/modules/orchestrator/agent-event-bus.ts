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
  /** P10: set by RedisEventBridge to forward LOCAL emits cross-replica. */
  private wireTap: ((event: AgentEvent) => void) | null = null;

  emit(event: AgentEvent): void {
    this.ring.push(event);
    if (this.ring.length > RING_LIMIT) this.ring.shift();
    for (const listener of this.listeners) listener(event);
    this.wireTap?.(event);
  }

  /** An event that arrived from another replica: re-emitted locally, NEVER
   * re-forwarded (the bridge's origin check already guards, this is belt
   * AND suspenders). */
  emitRemote(event: AgentEvent): void {
    this.ring.push(event);
    if (this.ring.length > RING_LIMIT) this.ring.shift();
    for (const listener of this.listeners) listener(event);
  }

  setWireTap(tap: ((event: AgentEvent) => void) | null): void {
    this.wireTap = tap;
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recent(limit: number): readonly AgentEvent[] {
    return this.ring.slice(-limit);
  }
}
