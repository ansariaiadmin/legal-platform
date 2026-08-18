/**
 * Normalized provider error class for consistent error handling across all providers.
 */
export class ProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    retryable: boolean = false,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

/**
 * Provider error codes as per SPEC section 10.
 */
export const PROVIDER_ERROR_CODES = {
  CONFIG_INVALID: 'PROVIDER_CONFIG_INVALID',
  AUTH_FAILED: 'PROVIDER_AUTH_FAILED',
  RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  NETWORK_ERROR: 'PROVIDER_NETWORK_ERROR',
  TIMEOUT: 'PROVIDER_TIMEOUT',
  NOT_FOUND: 'PROVIDER_NOT_FOUND',
  INVALID_REQUEST: 'PROVIDER_INVALID_REQUEST',
  UNSUPPORTED_OPERATION: 'PROVIDER_UNSUPPORTED_OPERATION',
  SERVICE_UNAVAILABLE: 'PROVIDER_SERVICE_UNAVAILABLE',
} as const;
