// API contracts shared between the API and the web app.
// Error code prefixes as per SPEC section 10.
export const ERROR_PREFIXES = {
  AUTH: 'AUTH_',
  VALIDATION: 'VALIDATION_',
  PAYMENT: 'PAYMENT_',
  PROVIDER: 'PROVIDER_',
  AI: 'AI_',
  DB: 'DB_',
  BACKUP: 'BACKUP_',
  SYSTEM: 'SYSTEM_',
  // P2a — commerce & consultation
  WALLET: 'WALLET_',
  QUEUE: 'QUEUE_',
  LAWYER: 'LAWYER_',
  TICKET: 'TICKET_',
  PURCHASE: 'PURCHASE_',
  SUBSCRIPTION: 'SUBSCRIPTION_',
  COMMS: 'COMMS_',
  DRAFT: 'DRAFT_',
  MACHINE_TOKEN: 'MACHINE_TOKEN_',
  SECURITY: 'SECURITY_',
} as const;

export type ErrorCodePrefix = (typeof ERROR_PREFIXES)[keyof typeof ERROR_PREFIXES];

/**
 * Concrete error codes currently emitted by the platform.
 * Keep this list in sync with the throw sites; the exception filter rejects
 * any code that does not start with one of ERROR_PREFIXES.
 */
export const ERROR_CODES = {
  // auth
  AUTH_MISSING_TOKEN: 'AUTH_MISSING_TOKEN',
  AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  AUTH_INVALID_CODE: 'AUTH_INVALID_CODE',
  AUTH_CODE_EXPIRED: 'AUTH_CODE_EXPIRED',
  AUTH_RATE_LIMITED: 'AUTH_RATE_LIMITED',
  AUTH_RESEND_COOLDOWN: 'AUTH_RESEND_COOLDOWN',
  AUTH_INVALID_SESSION: 'AUTH_INVALID_SESSION',
  AUTH_SESSION_REVOKED: 'AUTH_SESSION_REVOKED',
  AUTH_SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  AUTH_DEPENDENCY_DOWN: 'AUTH_DEPENDENCY_DOWN',
  AUTH_USER_NOT_FOUND: 'AUTH_USER_NOT_FOUND',
  AUTH_INSUFFICIENT_ROLE: 'AUTH_INSUFFICIENT_ROLE',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_CHALLENGE_INVALID: 'AUTH_CHALLENGE_INVALID',
  AUTH_CREDENTIAL_COMPROMISED: 'AUTH_CREDENTIAL_COMPROMISED',
  // validation
  VALIDATION_INVALID_PHONE: 'VALIDATION_INVALID_PHONE',
  VALIDATION_INVALID_INPUT: 'VALIDATION_INVALID_INPUT',
  // payment
  PAYMENT_INTENT_NOT_FOUND: 'PAYMENT_INTENT_NOT_FOUND',
  PAYMENT_CALLBACK_INVALID: 'PAYMENT_CALLBACK_INVALID',
  // provider
  PROVIDER_CONFIG_INVALID: 'PROVIDER_CONFIG_INVALID',
  PROVIDER_NOT_FOUND: 'PROVIDER_NOT_FOUND',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  // ai
  AI_NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  AI_NO_EXPERT_MATCHED: 'AI_NO_EXPERT_MATCHED',
  AI_AGENT_NOT_AUTHORIZED: 'AI_AGENT_NOT_AUTHORIZED',
  // database
  DB_QUERY_FAILED: 'DB_QUERY_FAILED',
  // backup
  BACKUP_NOT_FOUND: 'BACKUP_NOT_FOUND',
  // security
  SECURITY_INVALID_ENCRYPTED_FORMAT: 'SECURITY_INVALID_ENCRYPTED_FORMAT',
  SECURITY_DECRYPTION_FAILED: 'SECURITY_DECRYPTION_FAILED',
  // system
  SYSTEM_INTERNAL_ERROR: 'SYSTEM_INTERNAL_ERROR',
  // P2a — commerce & consultation
  WALLET_INSUFFICIENT_FUNDS: 'WALLET_INSUFFICIENT_FUNDS',
  QUEUE_CLOSED: 'QUEUE_CLOSED',
  LAWYER_OFFLINE: 'LAWYER_OFFLINE',
  TICKET_NOT_FOUND: 'TICKET_NOT_FOUND',
  PURCHASE_NOT_FOUND: 'PURCHASE_NOT_FOUND',
  TICKET_WRONG_STATUS: 'TICKET_WRONG_STATUS',
  PAYMENT_GATEWAY_ERROR: 'PAYMENT_GATEWAY_ERROR',
  SUBSCRIPTION_ACTIVE: 'SUBSCRIPTION_ACTIVE',
  SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED',
  COMMS_NOT_CONFIGURED: 'COMMS_NOT_CONFIGURED',
  SYSTEM_NOT_IMPLEMENTED: 'SYSTEM_NOT_IMPLEMENTED',
  // P4 — drafting with citations
  DRAFT_NOT_FOUND: 'DRAFT_NOT_FOUND',
  DRAFT_NO_CITATIONS: 'DRAFT_NO_CITATIONS',
  DRAFT_ILLEGAL_TRANSITION: 'DRAFT_ILLEGAL_TRANSITION',
  DRAFT_AI_UNAVAILABLE: 'DRAFT_AI_UNAVAILABLE',
  // P5 machine tokens — gate failures are AUTH-class, never 500
  MACHINE_TOKEN_INVALID: 'MACHINE_TOKEN_INVALID',
  MACHINE_TOKEN_REQUIRED: 'MACHINE_TOKEN_REQUIRED',
  // P6 hardening — transport/payload hygiene must never surface as 500
  VALIDATION_MALFORMED_JSON: 'VALIDATION_MALFORMED_JSON',
  VALIDATION_BODY_TOO_LARGE: 'VALIDATION_BODY_TOO_LARGE',
  SECURITY_RATE_LIMITED: 'SECURITY_RATE_LIMITED',
  SECURITY_SCAN_FAILED: 'SECURITY_SCAN_FAILED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export function successResponse<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

export function errorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ApiResponse<never> {
  return { success: false, error: { code, message, details } };
}

/** True when `code` uses one of the prefixes mandated by SPEC section 10. */
export function isKnownErrorCode(code: string): boolean {
  return Object.values(ERROR_PREFIXES).some((prefix) => code.startsWith(prefix));
}

/**
 * HTTP status implied by an error code, used by the global exception filter.
 *
 * Prefix-based rather than an enumerated list: an enumerated list silently
 * drops new codes to 500, which is exactly how AUTH_CODE_EXPIRED ended up
 * answering 500 instead of 401.
 */
export function httpStatusForCode(code: string): number {
  if (code.startsWith(ERROR_PREFIXES.VALIDATION)) return 400;
  // A webhook payload the gateway sent badly is the caller's problem, not ours.
  if (code === ERROR_CODES.PAYMENT_CALLBACK_INVALID) return 400;
  // P2a commerce: not enough money is a client-payable situation; the
  // closed queue / offline lawyer are conflicts-with-current-state.
  if (code.startsWith(ERROR_PREFIXES.WALLET)) return 402;
  if (code.startsWith(ERROR_PREFIXES.QUEUE) || code.startsWith(ERROR_PREFIXES.LAWYER)) return 409;
  if (code.startsWith(ERROR_PREFIXES.TICKET) || code.startsWith(ERROR_PREFIXES.COMMS)) return 409;
  if (code === ERROR_CODES.SUBSCRIPTION_ACTIVE) return 409;
  if (code === ERROR_CODES.SUBSCRIPTION_EXPIRED) return 403;
  if (code === ERROR_CODES.PURCHASE_NOT_FOUND) return 404;
  if (code === ERROR_CODES.AUTH_RATE_LIMITED || code === ERROR_CODES.AUTH_RESEND_COOLDOWN) return 429;
  if (code === ERROR_CODES.AUTH_INSUFFICIENT_ROLE) return 403;
  if (code.startsWith(ERROR_PREFIXES.MACHINE_TOKEN)) return 401;
  if (code === ERROR_CODES.SECURITY_SCAN_FAILED) return 500;
  if (code === ERROR_CODES.SECURITY_RATE_LIMITED) return 429;
  if (code === ERROR_CODES.VALIDATION_BODY_TOO_LARGE) return 413;
  if (code.startsWith(ERROR_PREFIXES.AUTH)) return 401;
  if (code.endsWith('_NOT_FOUND')) return 404;
  // P4 drafting: blocked generation is "valid request, missing citations";
  // an illegal workflow hop conflicts with state; the AI seam being absent is upstream.
  if (code === ERROR_CODES.DRAFT_NO_CITATIONS) return 422;
  if (code === ERROR_CODES.DRAFT_ILLEGAL_TRANSITION) return 409;
  if (code === ERROR_CODES.DRAFT_AI_UNAVAILABLE) return 502;
  if (code === ERROR_CODES.PAYMENT_GATEWAY_ERROR) return 502; // upstream payment hub failed, not the client's syntax
  if (code.startsWith(ERROR_PREFIXES.PROVIDER) || code.startsWith(ERROR_PREFIXES.AI)) return 502;
  return 500;
}
