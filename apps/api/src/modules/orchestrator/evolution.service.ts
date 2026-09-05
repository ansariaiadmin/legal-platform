import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { createExpertAgent, vocabularyScore } from '@legal-platform/shared';
import type { IExpertAgent } from '@legal-platform/shared';
import { LegalField } from '@legal-platform/domain';
import { ExpertRegistry } from './expert-registry';
import { InProcessAgentEventBus } from './agent-event-bus';

export interface SpawnAgentSpec {
  agentId: string; // kebab-case, ends with -expert
  field: string; // one of LegalField
  displayName: string;
  motto: string;
  /** [{idNS}: e.g. 'custom:contracts-review', terms] */
  skills: Array<{ id: string; description: string; terms: string[] }>;
  spawnedBy: string; // owner user id — audit + event attribution
}

export interface SpawnResult {
  agentId: string;
  field: string;
  skillIds: string[];
  /** truths the caller MUST show the user (no silent power-ups) */
  notices: string[];
}

export const SPAWN_RULES = {
  agentIdPattern: /^[a-z][a-z0-9-]+-expert$/,
  skillNamespacePattern: /^[a-z][a-z0-9-]*:[a-z0-9:-]+$/,
  maxSkillsPerSpawn: 6,
  minTermsPerSkill: 3,
} as const;

/**
 * Evolution engine (ADR-009): the Leader grows the society at runtime.
 *
 * Deliberate guardrails:
 *  - spawning NEVER bypasses governance — a spawned agent starts with ZERO
 *    grants; the owner must grant capabilities exactly like everyone else;
 *  - spawned members are always built from createExpertAgent (ADR-007) so
 *    every society law (requiresReview, honest grounding) holds from birth;
 *  - in-memory per process until the registry migration (P1-T6) — a restart
 *    depopulates spawned members loudly, never resurrects them silently.
 */
@Injectable()
export class EvolutionService {
  constructor(
    private readonly registry: ExpertRegistry,
    private readonly bus: InProcessAgentEventBus,
  ) {}

  private validate(spec: SpawnAgentSpec): string[] {
    const problems: string[] = [];
    if (!SPAWN_RULES.agentIdPattern.test(spec.agentId)) {
      problems.push('agentId must be kebab-case ending with -expert');
    }
    if (!Object.values(LegalField).includes(spec.field as LegalField)) {
      problems.push(`field must be one of: ${Object.values(LegalField).join(', ')}`);
    }
    if (!spec.displayName.trim() || !spec.motto.trim()) {
      problems.push('persona displayName and motto are required (society members introduce themselves)');
    }
    if (spec.skills.length === 0) problems.push('at least one skill is required');
    if (spec.skills.length > SPAWN_RULES.maxSkillsPerSpawn) {
      problems.push(`max ${SPAWN_RULES.maxSkillsPerSpawn} skills per spawn`);
    }
    for (const s of spec.skills) {
      if (!SPAWN_RULES.skillNamespacePattern.test(s.id)) problems.push(`skill id malformed: ${s.id}`);
      if (s.terms.length < SPAWN_RULES.minTermsPerSkill) {
        problems.push(`skill ${s.id} needs ≥${SPAWN_RULES.minTermsPerSkill} vocabulary terms`);
      }
    }
    return problems;
  }

  spawn(spec: SpawnAgentSpec): SpawnResult {
    const problems = this.validate(spec);
    if (problems.length > 0) {
      // problems inline in the message: the exception filter passes message
      // text through in the error envelope, so dashboard + humans + tests all
      // see exactly WHY the spawn failed.
      throw new BadRequestException(`spawn rejected: ${problems.join('; ')}`);
    }
    if (this.registry.get(spec.agentId)) {
      throw new ConflictException(`agent already exists: ${spec.agentId}`);
    }

    const agent: IExpertAgent = createExpertAgent({
      agentId: spec.agentId,
      version: '0.1.0-spawned',
      field: spec.field,
      skills: spec.skills.map((s) => ({
        id: s.id,
        description: s.description,
        match: ({ query }: { query: string }) => vocabularyScore(s.terms, query),
      })),
      persona: { displayName: spec.displayName, motto: spec.motto },
    });
    this.registry.register(agent);

    this.bus.emit({
      kind: 'grant.issued', // reuse stream surface; kind stays serializable
      at: new Date().toISOString(),
      taskId: 'evolution',
      agentId: spec.agentId,
      detail: `spawned by=${spec.spawnedBy} field=${spec.field} skills=${spec.skills.length}`,
    });

    return {
      agentId: spec.agentId,
      field: spec.field,
      skillIds: spec.skills.map((s) => s.id),
      notices: [
        'ایجنت جدید هنوز هیچ گرنتی ندارد — برای فعال شدن از بخش Grants مجوز صادر کنید.',
        'اسپاون فعلی در حافظه فرایند است؛ ماندگاری دیتابیسی در نقشه راه (P1-T6) می‌آید.',
        `requiresReview=true — خروجی ${spec.agentId} هم مانند همه اعضا نیازمند بازبینی وکیل است.`,
      ],
    };
  }

  /** Immediate removal — the anti-mistake button; governance stays clean. */
  retire(agentId: string, actorId: string): boolean {
    const agent = this.registry.get(agentId);
    if (!agent || !agent.version.endsWith('-spawned')) return false; // fleet-core members are protected
    this.registry.remove(agentId);
    this.bus.emit({
      kind: 'grant.revoked',
      at: new Date().toISOString(),
      taskId: 'evolution',
      agentId,
      detail: `retired by=${actorId}`,
    });
    return true;
  }
}
