import { Injectable } from '@nestjs/common';
import type {
  AgentResult,
  AgentTask,
  IExpertAgent,
  ISkill,
} from '@legal-platform/shared';
import { LegalField } from '@legal-platform/domain';
// NOTE: these MUST be runtime imports — reflect-metadata writes them into
// design:paramtypes for the DI graph; `import type` erases to Object.
import { InProcessAgentEventBus } from '../orchestrator/agent-event-bus';
import { SecurityAuditService } from './security-audit.service';

export const SECURITY_GUARDIAN_ID = 'security-guardian';
export const SECURITY_GUARDIAN_VERSION = '1.0.0';

const SECURITY_KEYWORDS = [
  'امنیت', 'امنیتی', 'رخنه', 'حمله', 'نفوذ', 'استاندارد', 'تطابق', 'حفره',
  'security', 'audit', 'compliance', 'vulnerability', 'خطر', 'تبعات',
];

/**
 * The Security Guardian (P6-S3). A permanent fleet member whose single duty
 * is keeping the platform's security posture at 10/10 — it re-runs the
 * standards probes, notices regressions vs. the previous report by reading
 * the persisted history, and REPORTS TO THE LEADER through the shared event
 * bus (kind 'security.scanned'), which the leader cockpit already streams.
 *
 * Honest placement in the expert tree: field GENERAL, requiresReview=true —
 * its output is an advisory report a lawyer may read, never legal advice
 * (SPEC §9 applies even to non-legal agents).
 */
@Injectable()
export class SecurityGuardianAgent implements IExpertAgent {
  readonly agentId = SECURITY_GUARDIAN_ID;
  readonly kind = 'guardian' as const;
  readonly version = SECURITY_GUARDIAN_VERSION;
  readonly field = LegalField.GENERAL;
  readonly subspecialties = ['platform-security', 'standards-compliance', 'threat-hygiene'] as const;
  readonly persona = {
    displayName: 'نگهبان امنیت سکو',
    motto: 'استاندارد امروز، امنیت فردا؛ گزارش من فقط مدارک واقعی است.',
  };
  readonly requiresReview = true;

  constructor(
    private readonly audit: SecurityAuditService,
    private readonly bus: InProcessAgentEventBus,
  ) {}

  capabilities(): readonly ISkill[] {
    return [
      {
        id: 'security:standards-audit',
        description: 'Run the OWASP/ASVS/NIST-CSF standards matrix and score posture (0–10)',
        match: ({ query }: Pick<AgentTask, 'query'>) => {
          const q = query;
          const hits = SECURITY_KEYWORDS.filter((k) => q.includes(k)).length;
          return Math.min(0.2 + hits * 0.35, 1);
        },
      },
      {
        id: 'security:regression-watch',
        description: 'Compare newest report with the previous one and explain regressions',
        match: ({ query }: Pick<AgentTask, 'query'>) =>
          query.includes('رگرسیون') || query.includes('regress') ? 0.9 : 0.1,
      },
    ];
  }

  async health(): Promise<{ healthy: boolean; detail?: string }> {
    return { healthy: true, detail: `standards=${this.audit.listStandards().length}` };
  }

  async route(task: Pick<AgentTask, 'query'>, minScore = 0.34): Promise<{ skillId: string; score: number } | null> {
    let best: { skillId: string; score: number } | null = null;
    for (const s of this.capabilities()) {
      const score = s.match(task);
      if (best === null || score > best.score) best = { skillId: s.id, score };
    }
    return best !== null && best.score >= minScore ? best : null;
  }

  async executeExpert(task: AgentTask): Promise<AgentResult> {
    return this.executeTask(task);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    return this.executeTask(task);
  }

  /**
   * Runs the audit, persists it, emits the leader-facing event. The event
   * detail carries ONLY the score + counts + regression ids — never evidence
   * strings (bus events are dashboard-shared; evidence stays in the stored
   * report behind LAWYER_OWNER).
   */
  private async executeTask(task: AgentTask): Promise<AgentResult> {
    const report = await this.audit.runAndPersist('agent');
    this.bus.emit({
      kind: 'security.scanned',
      at: report.at,
      taskId: `sec-${task.taskId}`,
      agentId: this.agentId,
      detail: `posture=${report.postureScore}/10 passed=${report.passed} warn=${report.warned} fail=${report.failed} regressed=${report.deltas.regressed.join(',') || 'none'} reportId=${report.reportId}`,
    });
    return {
      ok: true,
      output:
        `گزارش نگهبان امنیت (${report.at.slice(0, 10)}): امتیاز وضعیت ${report.postureScore}/۱۰ — ` +
        `${report.passed} قبول، ${report.warned} هشدار، ${report.failed} رد. ` +
        (report.deltas.regressed.length > 0
          ? `⚠️ رگرسیون نسبت به گزارش قبلی: ${report.deltas.regressed.join('، ')}.`
          : 'بدون رگرسیون نسبت به گزارش قبلی.'),
      meta: {
        reportId: report.reportId,
        postureScore: report.postureScore,
        standardsVersion: report.standardsVersion,
      },
    };
  }
}
