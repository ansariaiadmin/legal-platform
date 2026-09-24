/**
 * agent-kit — the society's genetic code (ADR-000, SPEC §11a).
 *
 * EVERY expert in apps/agents/{branch} is built by createExpertAgent(); nobody
 * hand-rolls one. This gives the fleet its common law: identical invariants
 * (review required, honest grounding, thresholded routing, stable identity),
 * while each branch supplies its own genome via a declarative definition —
 * capabilities, persona, field vocabulary. Feeling luxury is uniformity plus
 * character; this file is the uniformity.
 */
import type {
  AgentResult,
  AgentTask,
  IExpertAgent,
  ISkill,
} from './interfaces';

export interface AgentPersona {
  /** Persian display persona for the dashboard + drafts footer. */
  displayName: string; // e.g. 'کارشناس ارشد امور مدنی'
  motto: string; // one line of character, shown on the fleet card
  /** P7 bilingual: optional English twin — dashboards render per locale. */
  displayNameEn?: string;
  mottoEn?: string;
}

export interface ExpertAgentSpec {
  agentId: string;
  version: string;
  field: string;
  skills: readonly ISkill[];
  persona: AgentPersona;
  subspecialties?: readonly string[];
  /** routing bar for this agent (default 0.4) */
  minScore?: number;
  /**
   * Optional custom executor for real agents (civil, criminal).
   * If provided, will be used instead of mock response.
   * Must still respect requiresReview invariant.
   */
  customExecute?: (task: AgentTask, routed: { skillId: string; score: number } | null) => Promise<AgentResult> | AgentResult;
}

/**
 * The two rules every society member swears by (SPEC §9 / §11a):
 *  1. requiresReview = true, forever. Nothing here is final legal advice.
 *  2. grounded=false while RAG is off (P4). Agents NEVER impersonate a
 *     grounded answer — calm honesty is the luxury of this product.
 */
const SOCIETY_LAWS = { requiresReview: true as const, groundingHonesty: true as const };

export function createExpertAgent(spec: ExpertAgentSpec): IExpertAgent {
  const minScore = spec.minScore ?? 0.4;

  const agent: IExpertAgent = {
    kind: 'expert',
    agentId: spec.agentId,
    version: spec.version,
    field: spec.field,
    subspecialties: spec.subspecialties ?? [],
    persona: spec.persona,
    requiresReview: SOCIETY_LAWS.requiresReview,

    capabilities(): readonly ISkill[] {
      return spec.skills;
    },

    async health() {
      return { healthy: true };
    },

    async route(task: Pick<AgentTask, 'query'>, floor = minScore) {
      let best: { skillId: string; score: number } | null = null;
      for (const skill of spec.skills) {
        const score = skill.match(task);
        if (!best || score > best.score) best = { skillId: skill.id, score };
      }
      return best && best.score >= floor ? best : null;
    },

    async executeExpert(task: AgentTask): Promise<AgentResult> {
      const routed = await agent.route(task);

      // If custom executor provided (real agent), use it
      if (spec.customExecute) {
        try {
          const result = await spec.customExecute(task, routed);
          // Enforce invariants: requiresReview always true, grounded false unless RAG
          return {
            ...result,
            meta: {
              ...result.meta,
              requiresReview: true,
              grounded: result.meta?.grounded ?? false,
              routedSkillId: routed?.skillId ?? null,
              score: routed?.score ?? 0,
              persona: spec.persona.displayName,
            },
          };
        } catch (error) {
          return {
            ok: false,
            output: `خطا در اجرای ایجنت ${spec.agentId}: ${error instanceof Error ? error.message : String(error)}`,
            errorCode: 'AGENT_EXECUTION_FAILED',
            meta: {
              grounded: false,
              requiresReview: true,
              routedSkillId: routed?.skillId ?? null,
              score: routed?.score ?? 0,
              error: error instanceof Error ? error.message : String(error),
            },
          };
        }
      }

      // Default mock behavior (for agents not yet real)
      return {
        ok: true,
        output:
          `${spec.persona.displayName} (${spec.agentId}) — پرسش دریافت شد. ` +
          `این پاسخ مولدنشده است؛ تا اتصال RAG (فاز ۴) هیچ‌وقت به‌عنوان نظر حقوقی نهایی ارائه نمی‌شود. ` +
          `مهارت انتخاب‌شده: ${routed?.skillId ?? 'none'}.`,
        meta: {
          grounded: false,
          requiresReview: true,
          routedSkillId: routed?.skillId ?? null,
          score: routed?.score ?? 0,
          persona: spec.persona.displayName,
        },
      };
    },

    async execute(task: AgentTask): Promise<AgentResult> {
      // closure, not `this` — an extracted method reference must never lose
      // its binding when the registry hands agents around.
      return agent.executeExpert(task);
    },
  };

  return agent;
}
