import type {
  AgentResult,
  AgentTask,
  IExpertAgent,
  ISkill,
} from '@legal-platform/shared';
import { LegalField } from '@legal-platform/domain';
import { AGENT_ID, AGENT_VERSION, skills } from '../capabilities';

const DEFAULT_MIN_SCORE = 0.4;

/**
 * Reference IExpertAgent implementation (SPEC §11a): the template new experts
 * are built from. It is deliberately answerless and is NOT registered in the
 * production fleet (see apps/api/src/modules/orchestrator/agents.bootstrap.ts),
 * because a template that fabricated legal text would violate SPEC §9.
 */
export class LegalExpertBaseAgent implements IExpertAgent {
  readonly kind = 'expert' as const;
  readonly agentId = AGENT_ID;
  readonly version = AGENT_VERSION;
  readonly field = LegalField.GENERAL;
  readonly subspecialties = [] as const;
  /** Everything legal-facing in this fleet needs review (SPEC §9, §11a). */
  readonly requiresReview = true;

  capabilities(): readonly ISkill[] {
    return skills;
  }

  async health(): Promise<{ healthy: boolean; detail?: string }> {
    // Skeleton is self-contained; Phase 4 adds AI-provider circuit state here.
    return { healthy: true };
  }

  /** Field-then-skill deep route; the tree's shortest-path unit. */
  async route(
    task: Pick<AgentTask, 'query'>,
    minScore = DEFAULT_MIN_SCORE,
  ): Promise<{ skillId: string; score: number } | null> {
    let best: { skillId: string; score: number } | null = null;
    for (const skill of this.capabilities()) {
      const score = skill.match(task);
      if (!best || score > best.score) best = { skillId: skill.id, score };
    }
    return best && best.score >= minScore ? best : null;
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const route = await this.route(task);
    return {
      ok: true,
      output:
        'این قالب مرجع برای ساخت دستیار تخصصی جدید است و پاسخ حقوقی تولید نمی‌کند. ' +
        `مهارت تشخیص‌داده‌شده: ${route?.skillId ?? 'هیچ‌کدام'}.`,
      meta: {
        routedSkillId: route?.skillId ?? null,
        score: route?.score ?? 0,
        grounded: false,
      },
    };
  }

  executeExpert(task: AgentTask): Promise<AgentResult> {
    return this.execute(task);
  }
}
