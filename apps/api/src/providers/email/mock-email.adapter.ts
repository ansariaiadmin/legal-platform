import { Injectable, Logger } from '@nestjs/common';
import type { EmailProvider, EmailSendInput, EmailSendResult } from './email.provider';

interface MockMail extends EmailSendInput {
  at: string;
}

/**
 * Dev/test adapter: keeps an inspectable outbox (mirrors MockSmsAdapter) and
 * logs honestly. Production forbids it — the factory guard enforces that,
 * NOT a comment here.
 */
@Injectable()
export class MockEmailAdapter implements EmailProvider {
  private readonly logger = new Logger(MockEmailAdapter.name);
  private readonly outbox: MockMail[] = [];

  async sendMail(input: EmailSendInput): Promise<EmailSendResult> {
    this.outbox.push({ ...input, at: new Date().toISOString() });
    this.logger.log(`[MOCK EMAIL] to=${input.to} subject=${JSON.stringify(input.subject)}`);
    return { success: true, messageId: `mock-email-${this.outbox.length}` };
  }

  messagesFor(to: string): MockMail[] {
    return this.outbox.filter((m) => m.to === to);
  }

  async verifyConfig(): Promise<{ valid: true }> {
    return { valid: true };
  }

  getMetadata() {
    return { name: 'mock-email', driverType: 'mock' as const };
  }
}
