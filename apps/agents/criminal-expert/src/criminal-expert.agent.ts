import { createExpertAgent } from '@legal-platform/shared';
import { LegalField } from '@legal-platform/domain';
import { AGENT_ID, AGENT_VERSION, skills } from '../capabilities';

export const criminalExpert = createExpertAgent({
  agentId: AGENT_ID,
  version: AGENT_VERSION,
  field: LegalField.CRIMINAL,
  skills,
  subspecialties: ['defense', 'procedure', 'sentencing', 'crimes'],
  persona: {
    displayName: 'کارشناس ارشد امور کیفری',
    motto: 'اصل برائت اول است؛ دفاعِ هنرمندانه از محضر دادسرا شروع می‌شود.',
  },
});
