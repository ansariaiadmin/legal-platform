import { ConfigService } from '@nestjs/config';
import {
  TelephonyProvider,
  CallSession,
  InboundCallEvent,
  TelephonyProviderMetadata,
} from './telephony.provider';

export class MockTelephonyAdapter implements TelephonyProvider {
  private readonly calls: Map<string, CallSession> = new Map();

  constructor(private configService: ConfigService) {}

  async createOutboundCall(input: {
    toNumber: string;
    fromNumber?: string;
    callbackUrl?: string;
    timeoutSeconds?: number;
  }): Promise<CallSession> {
    const callId = `mock_call_${Date.now()}`;
    const now = new Date();

    const session: CallSession = {
      callId,
      status: 'initiated',
      toNumber: input.toNumber,
      fromNumber: input.fromNumber ?? '+982100000000',
      startedAt: now,
    };

    this.calls.set(callId, session);

    // Simulate call progression
    setTimeout(() => {
      const s = this.calls.get(callId);
      if (s) {
        s.status = 'ringing';
      }
    }, 1000);

    setTimeout(() => {
      const s = this.calls.get(callId);
      if (s) {
        s.status = 'answered';
        s.answeredAt = new Date();
      }
    }, 3000);

    setTimeout(() => {
      const s = this.calls.get(callId);
      if (s) {
        s.status = 'completed';
        s.endedAt = new Date();
        s.durationSeconds = 10;
      }
    }, 13000);

    return session;
  }

  async handleInboundWebhook(payload: Record<string, unknown>): Promise<InboundCallEvent> {
    const callId = (payload.CallSid || payload.call_id || `mock_inbound_${Date.now()}`) as string;
    const fromNumber = (payload.From || payload.from_number || '+989120000000') as string;
    const toNumber = (payload.To || payload.to_number || '+982100000000') as string;
    const callStatus = (payload.CallStatus || payload.status || 'ringing') as string;

    const statusMap: Record<string, InboundCallEvent['status']> = {
      ringing: 'ringing',
      'in-progress': 'answered',
      completed: 'completed',
      missed: 'missed',
      failed: 'missed',
    };

    const event: InboundCallEvent = {
      callId,
      fromNumber,
      toNumber,
      direction: 'inbound',
      status: statusMap[callStatus] || 'ringing',
      timestamp: new Date(),
      rawPayload: payload,
    };

    return event;
  }

  async verifyConfig(): Promise<{ valid: boolean; error?: string }> {
    if (process.env.NODE_ENV === 'production') {
      return {
        valid: false,
        error: 'Mock telephony provider cannot be used in production',
      };
    }
    return { valid: true };
  }

  getMetadata(): TelephonyProviderMetadata {
    return {
      name: 'Mock Telephony Provider',
      supportsOutbound: true,
      supportsInbound: true,
      supportsRecording: false,
    };
  }
}
