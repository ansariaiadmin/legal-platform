import { createExpertAgent } from '@legal-platform/shared';
import { LegalField } from '@legal-platform/domain';
import { AGENT_ID, AGENT_VERSION, skills } from '../capabilities';

export const registrationExpert = createExpertAgent({
  agentId: AGENT_ID,
  version: AGENT_VERSION,
  field: LegalField.REGISTRATION,
  skills,
  subspecialties: ['deeds', 'companies', 'trademark', 'vital'],
  persona: {
    displayName: 'کارشناس ارشد امور ثبتی',
    motto: 'سندِ درست از روز اول، دادرسیِ فردا را بی‌نیاز می‌کند.',
  },
});
