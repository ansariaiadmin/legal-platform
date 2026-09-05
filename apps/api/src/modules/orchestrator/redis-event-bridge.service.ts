import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { AgentEvent } from '@legal-platform/shared';
import { RedisRespClient, RespSubscriber } from '../../providers/queue/redis-resp.client';
import { InProcessAgentEventBus } from './agent-event-bus';

const CHANNEL = 'legal:events:bus';

interface Envelope {
  o: string; // origin replica id — loop guard
  e: AgentEvent;
}

/**
 * P10-T-bus — the event floor goes across replicas. When
 * DEPLOYMENT_MODE=multi + REDIS_URL are set, every event a local agent emits
 * is PUBLISHed to `legal:events:bus`; events arriving from OTHER replicas are
 * re-emitted as LOCAL events so the SSE kitchen consumers keep their single
 * code path. Same-origin envelopes are dropped — the loop guard is structural
 * (origin UUID), not a hope.
 *
 * Fail honesty: subscriber errors log LOUDLY and retry with backoff; the bus
 * never stops working in-process because the bridge had a bad day. A down
 * bridge means the dashboard shows MY replica only — which is exactly what
 * /dashboard/ops/deployment reports until Redis returns.
 */
@Injectable()
export class RedisEventBridge implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisEventBridge.name);
  private readonly origin = randomUUID();
  private pub: RedisRespClient | null = null;
  private sub: RespSubscriber | null = null;
  private enabled = false;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly bus: InProcessAgentEventBus,
  ) {}

  onModuleInit(): void {
    const url = this.config.get<string>('REDIS_URL');
    const multi = this.config.get<string>('DEPLOYMENT_MODE') === 'multi';
    if (!multi || !url) {
      this.logger.log(`event bridge in-process only (DEPLOYMENT_MODE=${multi ? 'multi' : 'single'}, redis=${Boolean(url)})`);
      return;
    }
    try {
      this.pub = new RedisRespClient(url);
      this.enabled = true;
      this.bus.setWireTap((event) => void this.forward(event));
      this.startSubscriber(url);
      this.logger.log(`event bridge LIVE on ${CHANNEL} (origin=${this.origin.slice(0, 8)})`);
    } catch (e) {
      this.logger.error(`event bridge failed to start: ${(e as Error).message} — staying in-process`);
      this.enabled = false;
    }
  }

  onModuleDestroy(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.sub?.close();
  }

  /** True when the bridge is operational (ops readout asks this, not env). */
  isLive(): boolean {
    return this.enabled && this.sub !== null;
  }

  channel(): string {
    return CHANNEL;
  }

  private async forward(event: AgentEvent): Promise<void> {
    if (!this.pub) return;
    try {
      const envelope: Envelope = { o: this.origin, e: event };
      await this.pub.publish(CHANNEL, JSON.stringify(envelope));
    } catch (e) {
      this.logger.warn(`publish failed (bridge keeps bus local): ${(e as Error).message}`);
    }
  }

  private startSubscriber(url: string, attempt = 1): void {
    this.sub = new RespSubscriber(
      url,
      (channel, payload) => {
        if (channel !== CHANNEL) return;
        try {
          const env = JSON.parse(payload) as Envelope;
          if (env.o === this.origin) return; // loop guard
          if (!env.e || typeof env.e !== 'object') return;
          this.bus.emitRemote(env.e);
        } catch (e) {
          this.logger.warn(`bad event envelope dropped: ${(e as Error).message}`);
        }
      },
      (err) => {
        this.logger.error(`subscriber error: ${err.message}; retrying in ${Math.min(attempts(attempt), 30)}s`);
        this.sub?.close();
        this.sub = null;
        this.retryTimer = setTimeout(() => this.startSubscriber(url, attempt + 1), Math.min(attempts(attempt), 30) * 1000);
      },
    );
    try {
      this.sub.subscribe(CHANNEL);
    } catch (e) {
      this.logger.error(`subscribe failed: ${(e as Error).message}`);
    }
  }
}

function attempts(n: number): number {
  return Math.min(2 ** n, 30); // 2,4,8,16,30,30… — bounded backoff, never hot-loop
}
