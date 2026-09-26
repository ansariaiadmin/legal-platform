import type { SendSmsResult, SmsProvider } from './sms.provider';

/**
 * The SMS provider every module injects (`SMS_PROVIDER`).
 *
 * When the office has connected its own SMS panel in the dashboard
 * (Phone consultations → SMS panel), messages go through that panel.
 * Otherwise they go through the adapter selected by the environment
 * (`SMS_PROVIDER=mock|kavenegar|ghasedak`). One-time sign-in codes and
 * client notifications therefore always use the same gateway.
 */
export class RoutingSmsProvider implements SmsProvider {
  constructor(
    private readonly envProvider: SmsProvider,
    private readonly panelProvider: () => Promise<SmsProvider | null>,
  ) {}

  private async active(): Promise<SmsProvider> {
    try {
      return (await this.panelProvider()) ?? this.envProvider;
    } catch {
      // An unreadable panel configuration must not stop sign-in codes.
      return this.envProvider;
    }
  }

  async sendSms(input: { phone: string; message: string }): Promise<SendSmsResult> {
    return (await this.active()).sendSms(input);
  }

  async verifyConfig(): Promise<{ valid: boolean; error?: string }> {
    return (await this.active()).verifyConfig();
  }
}
