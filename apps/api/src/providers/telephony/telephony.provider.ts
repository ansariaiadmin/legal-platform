import { ProviderError } from '../provider.error';

export interface CallSession {
  callId: string;
  status: 'initiated' | 'ringing' | 'answered' | 'completed' | 'failed' | 'no_answer';
  toNumber: string;
  fromNumber?: string;
  startedAt?: Date;
  answeredAt?: Date;
  endedAt?: Date;
  durationSeconds?: number;
  recordingUrl?: string;
}

export interface InboundCallEvent {
  callId: string;
  fromNumber: string;
  toNumber: string;
  direction: 'inbound';
  status: 'ringing' | 'answered' | 'missed' | 'completed';
  timestamp: Date;
  rawPayload: Record<string, unknown>;
}

export interface TelephonyProviderConfig {
  accountId: string;
  authToken: string;
  phoneNumber?: string;
  webhookUrl?: string;
}

export interface TelephonyProviderMetadata {
  name: string;
  supportsOutbound: boolean;
  supportsInbound: boolean;
  supportsRecording: boolean;
}

export interface TelephonyProvider {
  createOutboundCall(input: {
    toNumber: string;
    fromNumber?: string;
    callbackUrl?: string;
    timeoutSeconds?: number;
  }): Promise<CallSession>;

  handleInboundWebhook(payload: Record<string, unknown>): Promise<InboundCallEvent>;

  verifyConfig(): Promise<{ valid: boolean; error?: string }>;

  getMetadata(): TelephonyProviderMetadata;
}

export { ProviderError };
