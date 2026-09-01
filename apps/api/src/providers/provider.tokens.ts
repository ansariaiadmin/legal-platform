/**
 * Injection tokens for provider categories.
 *
 * The provider contracts (SmsProvider, PaymentProvider, ...) are TypeScript
 * interfaces, so `emitDecoratorMetadata` cannot recover them at runtime - the
 * emitted `design:paramtypes` entry is `Object`. Every consumer must therefore
 * inject by one of these string tokens instead of by type.
 */
export const SMS_PROVIDER = Symbol.for('legal-platform.provider.sms');
export const PAYMENT_PROVIDER = Symbol.for('legal-platform.provider.payment');
export const PUSH_PROVIDER = Symbol.for('legal-platform.provider.push');
export const TELEPHONY_PROVIDER = Symbol.for('legal-platform.provider.telephony');
export const AI_PROVIDER = Symbol.for('legal-platform.provider.ai');
export const STORAGE_PROVIDER = Symbol.for('legal-platform.provider.storage');

export const PROVIDER_TOKENS = {
  sms: SMS_PROVIDER,
  payment: PAYMENT_PROVIDER,
  push: PUSH_PROVIDER,
  telephony: TELEPHONY_PROVIDER,
  ai: AI_PROVIDER,
  storage: STORAGE_PROVIDER,
} as const;

export type ProviderCategory = keyof typeof PROVIDER_TOKENS;

export const PROVIDER_CATEGORIES = Object.keys(PROVIDER_TOKENS) as ProviderCategory[];
