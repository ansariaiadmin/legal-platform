// Error code prefixes as per SPEC section 10
export const ERROR_PREFIXES = {
  AUTH: 'AUTH_',
  VALIDATION: 'VALIDATION_',
  PAYMENT: 'PAYMENT_',
  PROVIDER: 'PROVIDER_',
  AI: 'AI_',
  DB: 'DB_',
  BACKUP: 'BACKUP_',
  SECURITY: 'SECURITY_',
  SYSTEM: 'SYSTEM_',
} as const;

export type ErrorCodePrefix = typeof ERROR_PREFIXES[keyof typeof ERROR_PREFIXES];

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function successResponse<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

export function errorResponse(code: string, message: string, details?: Record<string, unknown>): ApiResponse<never> {
  return { success: false, error: { code, message, details } };
}
