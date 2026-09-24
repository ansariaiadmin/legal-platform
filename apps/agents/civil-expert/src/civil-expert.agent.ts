import { createExpertAgent } from '@legal-platform/shared';
import { LegalField } from '@legal-platform/domain';
import { AGENT_ID, AGENT_VERSION, skills } from '../capabilities';

/**
 * Society membership card for the civil desk. That is ALL this file should
 * ever be — behavior lives in agent-kit, vocabulary in capabilities.ts.
 * When this file grows logic, that logic belongs UPSTREAM in the kit so the
 * whole fleet inherits it.
 */
export const civilExpert = createExpertAgent({
  agentId: AGENT_ID,
  version: AGENT_VERSION,
  field: LegalField.CIVIL,
  skills,
  subspecialties: ['contracts', 'property', 'tort', 'inheritance'],
  persona: {
    displayName: 'کارشناس ارشد امور مدنی',
    motto: 'قانون مدنی را ماده‌به‌ماده پاس می‌دارد؛ هر بند قرارداد یک مسئولیت است.',
  },
});
