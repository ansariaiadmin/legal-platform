import { Injectable, Logger, Optional, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { InProcessAgentEventBus } from '../modules/orchestrator/agent-event-bus';
import type { AgentEvent } from '@legal-platform/shared';

/**
 * FIELD REVIEW 2026-09-05 #13 — critical signals were ending inside the
 * house: they fired on the in-process bus, and in a headless deployment NO
 * human ever read them. ALERT_WEBHOOK_URL (Slack/Discord/Telegram-bot
 * generic JSON POST) makes them reach the channel the office actually reads.
 *
 * Contract: POST application/json { text, severity, event } with 5s timeout;
 * failures are LOGGED, never thrown (the signal path must never destabilize
 * the thing it guards). No retry loops — one shot per event, by design.
 */
const CRITICAL_KINDS = new Set([
  'usage.alerted',
  'task.failed',
  'model.unassigned',
]);

@Injectable()
export class AlertRelayService implements OnModuleInit {
  private readonly logger = new Logger(AlertRelayService.name);

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly bus?: InProcessAgentEventBus,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<string>('ALERT_WEBHOOK_URL')) return; // opt-in only
    this.bus?.subscribe((event) => {
      void this.relay(event).catch((e) =>
        this.logger.error(`alert relay failed to call webhook: ${(e as Error).message}`),
      );
    });
    this.logger.log('alert relay armed (webhook configured)');
  }

  /** exposed for tests; also directly callable by non-bus sources */
  async relay(event: AgentEvent & { kind: string }): Promise<'sent' | 'ignored' | 'unconfigured'> {
    const url = this.config.get<string>('ALERT_WEBHOOK_URL');
    if (!url) return 'unconfigured';
    if (!CRITICAL_KINDS.has(event.kind)) return 'ignored';

    const text = `🛡️ [${event.kind}] ${event.agentId ?? 'platform'} — ${event.detail ?? ''}`.slice(0, 300);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, severity: 'warn', event: { kind: event.kind, at: event.at } }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      this.logger.warn(`alert webhook answered ${res.status} — event was still recorded locally`);
      return 'ignored';
    }
    return 'sent';
  }
}
