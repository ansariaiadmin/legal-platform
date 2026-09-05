import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AI_PROVIDER,
  EMAIL_PROVIDER,
  PAYMENT_PROVIDER,
  PUSH_PROVIDER,
  SMS_PROVIDER,
  STORAGE_PROVIDER,
  TELEPHONY_PROVIDER,
} from './provider.tokens';
import { adapterKeyFromEnv, createAdapterFor } from './provider.factory';

/**
 * Binds every provider category token to the adapter selected by the
 * environment (`SMS_PROVIDER`, `PAYMENT_PROVIDER`, ...).
 *
 * Global so feature modules can inject `@Inject(SMS_PROVIDER)` without
 * re-importing this module. Later this factory becomes the place where a
 * database-backed `provider_configs` row overrides the env default.
 */
@Global()
@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createAdapterFor('sms', adapterKeyFromEnv('sms', config), config),
    },
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createAdapterFor('payment', adapterKeyFromEnv('payment', config), config),
    },
    {
      provide: PUSH_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createAdapterFor('push', adapterKeyFromEnv('push', config), config),
    },
    {
      provide: TELEPHONY_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createAdapterFor('telephony', adapterKeyFromEnv('telephony', config), config),
    },
    {
      provide: AI_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createAdapterFor('ai', adapterKeyFromEnv('ai', config), config),
    },
    {
      provide: STORAGE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createAdapterFor('storage', adapterKeyFromEnv('storage', config), config),
    },
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createAdapterFor('email', adapterKeyFromEnv('email', config), config),
    },
  ],
  exports: [SMS_PROVIDER, PAYMENT_PROVIDER, PUSH_PROVIDER, TELEPHONY_PROVIDER, AI_PROVIDER, STORAGE_PROVIDER, EMAIL_PROVIDER],
})
export class ProviderRegistryModule {}
