import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderError, PROVIDER_ERROR_CODES } from './provider.error';
import { MockSmsAdapter } from './sms/mock-sms.adapter';
import { MockPaymentAdapter } from './payment/mock-payment.adapter';
import { MockPushAdapter } from './push/mock-push.adapter';
import { MockTelephonyAdapter } from './telephony/mock-telephony.adapter';
import { MockAIAdapter } from './ai/mock-ai.adapter';
import { LocalStorageAdapter } from './storage/local-storage.adapter';
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
      return new MockSmsAdapter();
    case 'payment':
      return new MockPaymentAdapter();
    case 'push':
      return new MockPushAdapter();
    case 'telephony':
      return new MockTelephonyAdapter();
    case 'ai':
      return new MockAIAdapter(config);
    case 'storage':
      return new LocalStorageAdapter(config);
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
