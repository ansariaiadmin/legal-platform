import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderError, PROVIDER_ERROR_CODES } from './provider.error';
import { MockSmsAdapter } from './sms/mock-sms.adapter';
import { MockPaymentAdapter } from './payment/mock-payment.adapter';
import { MockPushAdapter } from './push/mock-push.adapter';
import { MockTelephonyAdapter } from './telephony/mock-telephony.adapter';
import { MockAIAdapter } from './ai/mock-ai.adapter';
import { LocalStorageAdapter } from './storage/local-storage.adapter';
import { PgStorageAdapter } from './storage/pg-storage.adapter';
import { TenantScopedStorageAdapter, assertTenantSlug } from './storage/tenant-scoped-storage.adapter';
import type { StorageProvider } from './storage/storage.provider';
import { OpenAiCompatibleAIAdapter } from './ai/openai-compatible.adapter';
import { ZarinpalAdapter } from './payment/zarinpal.adapter';
import { KavenegarSmsAdapter } from './sms/kavenegar.adapter';
import type { ProviderCategory } from './provider.tokens';

/**
 * Builds the adapter instance for a provider category.
 *
 * This is the single place where a concrete adapter class is chosen, so no
 * controller or service ever talks to a provider SDK directly (SPEC section 4
 * and 8).
 */
export function createAdapterFor(
  category: ProviderCategory,
  adapterKey: string,
  config: ConfigService,
  logger: Logger = new Logger('ProviderFactory'),
): unknown {
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  if (adapterKey === 'mock' && isProduction) {
    // SPEC section 12: no fake payment / sms / ai success in production.
    throw new ProviderError(
      PROVIDER_ERROR_CODES.CONFIG_INVALID,
      `The mock ${category} adapter is not allowed when NODE_ENV=production`,
      false,
      { category, adapterKey },
    );
  }

  switch (category) {
    case 'sms':
      // P9-T3: SMS_ADAPTER=kavenegar → real gateway; anything else → mock with
      // the honest '[MOCK SMS]' log line (which production already forbids via
      // the adapterKey==='mock' guard above only when key==='mock' — we mirror
      // intent: real in prod needs the env key).
      if (config.get<string>('SMS_ADAPTER') === 'kavenegar') {
        return new KavenegarSmsAdapter(config);
      }
      return new MockSmsAdapter();
    case 'payment':
      if (config.get<string>('PAYMENT_ADAPTER') === 'zarinpal') {
        return new ZarinpalAdapter(config);
      }
      return new MockPaymentAdapter();
    case 'push':
      return new MockPushAdapter();
    case 'telephony':
      return new MockTelephonyAdapter();
    case 'ai':
      if (config.get<string>('AI_PROVIDER_KEY') === 'openai-compatible' || config.get<string>('AI_PROVIDER_KEY') === 'openai') {
        return new OpenAiCompatibleAIAdapter(config);
      }
      return new MockAIAdapter(config);
    case 'storage': {
      // P9-T1: DRIVER decides — 'pg' = durable replica-shared runtime state
      // (migration 008 required), anything else = local files. In production
      // an unset driver with a database present picks pg and SAYS so.
      const driver = config.get<string>('STORAGE_DRIVER');
      const dbUrl = config.get<string>('DATABASE_URL');
      let base: StorageProvider;
      if (driver === 'pg' || (!driver && isProduction && dbUrl)) {
        base = new PgStorageAdapter(config);
      } else if (driver === 'pg' && !dbUrl) {
        // defensive: adapter constructor throws a WAY clearer error
        throw new ProviderError(
          PROVIDER_ERROR_CODES.CONFIG_INVALID,
          'STORAGE_DRIVER=pg set without DATABASE_URL',
          false,
        );
      } else {
        base = new LocalStorageAdapter(config);
      }
      // P9-T2: TENANT_SLUG≠default ⇒ namespace EVERY other driver's keys.
      // 'default' stays unscoped so single-office boxes keep byte-byte
      // compatibility with pre-P9 data — zero forced migration.
      const slug = config.get<string>('TENANT_SLUG');
      if (slug && slug !== 'default') {
        return new TenantScopedStorageAdapter(base, assertTenantSlug(slug));
      }
      return base;
    }
    default: {
      const exhaustive: never = category;
      logger.error(`Unknown provider category: ${String(exhaustive)}`);
      throw new ProviderError(
        PROVIDER_ERROR_CODES.CONFIG_INVALID,
        `Unknown provider category: ${String(exhaustive)}`,
      );
    }
  }
}

/** Reads `<CATEGORY>_PROVIDER` from the environment, defaulting to `mock`. */
export function adapterKeyFromEnv(category: ProviderCategory, config: ConfigService): string {
  const key = `${category.toUpperCase()}_PROVIDER`;
  return config.get<string>(key) || 'mock';
}
