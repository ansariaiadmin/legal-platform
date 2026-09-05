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
