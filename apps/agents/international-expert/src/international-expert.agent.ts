import { createExpertAgent } from '@legal-platform/shared';
import { LegalField } from '@legal-platform/domain';
import { AGENT_ID, AGENT_VERSION, skills } from '../capabilities';

/**
 * The society membership card for the international desk — P7-T6. Same
 * discipline as every sibling: logic lives in agent-kit, vocabulary in
 * capabilities.ts. The bilingual persona is the visible contract that any
 * operator, in any country, gets the same citizen of the fleet.
 */
export const internationalExpert = createExpertAgent({
  agentId: AGENT_ID,
  version: AGENT_VERSION,
  field: LegalField.GENERAL,
  skills,
  subspecialties: ['treaties', 'cross-border', 'immigration', 'trade-sanctions'],
  persona: {
    displayName: 'کارشناس ارشد حقوق بین‌الملل',
    displayNameEn: 'Senior International-Law Counsel',
    motto: 'معاهده را ماده‌به‌ماده و مرز را عهد‌به‌عهد می‌شناسد؛ حکم خارجی به احترام و اجرا نیاز دارد.',
    mottoEn: 'Treaties article by article, borders covenant by covenant; a foreign judgment earns enforcement, never assumes it.',
  },
});
