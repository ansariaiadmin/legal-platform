import { ProviderError, PROVIDER_ERROR_CODES } from './provider.error';
import type { HealthCheckable } from './health-checkable';
import type { ProviderCategory } from './provider.tokens';

/**
 * Stand-in used in production when a provider category is still set to `mock`.
 *
 * The application boots normally, but the provider never reports a fake
 * success (SPEC section 12):
 * - `verifyConfig()` reports the category as not configured, so the dashboard
 *   and health checks disable the dependent feature (SPEC section 8);
 * - every other call rejects with `PROVIDER_CONFIG_INVALID` and a message that
 *   names the environment variable to set.
 */
const NON_METHOD_PROPS = new Set([
  'then',
  'constructor',
  'toJSON',
  // NestJS lifecycle hooks must not look like implemented methods.
  'onModuleInit',
  'onApplicationBootstrap',
  'onModuleDestroy',
  'beforeApplicationShutdown',
  'onApplicationShutdown',
]);

export function createUnconfiguredAdapter(category: ProviderCategory): HealthCheckable {
  const envKey = `${category.toUpperCase()}_PROVIDER`;
  const message = `The ${category} provider is not configured. Set ${envKey} (and its credentials) in .env.`;

  return new Proxy({} as HealthCheckable, {
    get(_target, prop) {
      if (typeof prop === 'symbol' || NON_METHOD_PROPS.has(prop) || prop.startsWith('__')) {
        return undefined;
      }
      if (prop === 'verifyConfig') {
        return async () => ({ valid: false, error: message });
      }
      if (prop === 'getMetadata') {
        return () => ({ name: 'unconfigured', category, configured: false, supportedTypes: [] });
      }
      return async () => {
        throw new ProviderError(PROVIDER_ERROR_CODES.CONFIG_INVALID, message, false, { category });
      };
    },
  });
}
