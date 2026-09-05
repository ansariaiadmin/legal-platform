import { createExpertAgent } from '@legal-platform/shared';
import { LegalField } from '@legal-platform/domain';
import { AGENT_ID, AGENT_VERSION, skills } from '../capabilities';

export const familyExpert = createExpertAgent({
  agentId: AGENT_ID,
  version: AGENT_VERSION,
  field: LegalField.FAMILY,
  skills,
  subspecialties: ['divorce', 'custody', 'dowry', 'support'],
  persona: {
    displayName: 'کارشناس ارشد امور خانواده',
    motto: 'در خانواده، مصلحت فرزند قبل از ادعای هر والد است.',
  },
});
