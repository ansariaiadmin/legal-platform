import { ConfigService } from '@nestjs/config';
import { MockTelephonyAdapter } from '../../src/providers/telephony/mock-telephony.adapter';

interface TelephonyContractTests {
  createOutboundCall: () => Promise<boolean>;
  handleInboundWebhook: () => Promise<boolean>;
  configHealthReporting: () => Promise<boolean>;
}

export function runTelephonyContractTests(configService?: ConfigService): TelephonyContractTests {
  const adapter = new MockTelephonyAdapter(configService || new ConfigService());

  return {
    async createOutboundCall(): Promise<boolean> {
      try {
        const session = await adapter.createOutboundCall({
          toNumber: '+989123456789',
        });
        return !!session.callId && session.status === 'initiated';
      } catch {
        return false;
      }
    },

    async handleInboundWebhook(): Promise<boolean> {
      try {
        const event = await adapter.handleInboundWebhook({
          CallSid: 'test_call',
          From: '+989123456789',
          To: '+982100000000',
          CallStatus: 'ringing',
        });
        return !!event.callId && event.direction === 'inbound';
      } catch {
        return false;
      }
    },

    async configHealthReporting(): Promise<boolean> {
      try {
        const health = await adapter.verifyConfig();
        return process.env.NODE_ENV !== 'production' ? health.valid === true : true;
      } catch {
        return false;
      }
    },
  };
}
