import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InProcessAgentEventBus } from '../orchestrator/agent-event-bus';
import { SecurityAuditService, type SecurityReport } from './security-audit.service';
import { SECURITY_GUARDIAN_ID } from './security-guardian.agent';

export const SCAN_INTERVAL_ENV = 'SECURITY_SCAN_INTERVAL_MS';
const DEFAULT_INTERVAL_MS = 86_400_000; // daily by standard hygiene default

/**
 * Nightly security sweep (P6-S3): the checks are cheap & side-effect-free,
 * but cadence is explicit config — `SECURITY_SCAN_INTERVAL_MS=0` disables it
 * (tests do exactly that), otherwise the guardian sweeps daily and pushes
 * its summary to the leader-facing bus (`security.scanned`).
 */
@Injectable()
export class SecuritySchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SecuritySchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;

  constructor(
    private readonly audit: SecurityAuditService,
    private readonly bus: InProcessAgentEventBus,
    config: ConfigService,
  ) {
    const raw = Number(config.get<string>(SCAN_INTERVAL_ENV) || '');
    this.intervalMs = Number.isFinite(raw) && raw > 0
      ? raw
      : config.get<string>(SCAN_INTERVAL_ENV) === '0'
        ? 0
        : DEFAULT_INTERVAL_MS;
  }

  onModuleInit(): void {
    if (this.intervalMs === 0 || (process.env.NODE_ENV === 'test')) {
      this.logger.log('security sweep disabled (test or SECURITY_SCAN_INTERVAL_MS=0)');
      return;
    }
    this.timer = setInterval(() => {
      this.runNow('scheduled').catch((err) =>
        this.logger.error(`scheduled security scan failed: ${err instanceof Error ? err.message : String(err)}`),
      );
    }, this.intervalMs);
    this.timer.unref();
    this.logger.log(`security sweep armed: every ${(this.intervalMs / 3_600_000).toFixed(1)}h`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  state(): { intervalMs: number; armed: boolean } {
    return { intervalMs: this.intervalMs, armed: this.timer !== null };
  }

  async runNow(source: 'scheduled' | 'manual'): Promise<SecurityReport> {
    const report = await this.audit.runAndPersist(source);
    this.bus.emit({
      kind: 'security.scanned',
      at: report.at,
      taskId: `sec-${source}-${Date.now()}`,
      agentId: SECURITY_GUARDIAN_ID,
      detail: `posture=${report.postureScore}/10 passed=${report.passed} warn=${report.warned} fail=${report.failed} regressed=${report.deltas.regressed.join(',') || 'none'} reportId=${report.reportId}`,
    });
    return report;
  }
}
