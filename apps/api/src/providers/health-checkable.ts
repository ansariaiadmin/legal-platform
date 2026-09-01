export interface HealthCheckResult {
  valid: boolean;
  error?: string;
}

/**
 * Every provider adapter implements this, which is what makes the dashboard
 * "Test connection" button and the automatic feature-disabling behaviour
 * (SPEC section 8) possible without knowing the concrete adapter type.
 */
export interface HealthCheckable {
  verifyConfig(): Promise<HealthCheckResult>;
}

export function isHealthCheckable(value: unknown): value is HealthCheckable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as HealthCheckable).verifyConfig === 'function'
  );
}
