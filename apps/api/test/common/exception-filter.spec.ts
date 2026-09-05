import { ArgumentsHost, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AllExceptionsFilter } from '../../src/common/all-exceptions.filter';
import { ERROR_CODES, httpStatusForCode, isKnownErrorCode } from '@legal-platform/contracts';

interface Harness {
  json: jest.Mock;
  status: jest.Mock;
  host: ArgumentsHost;
}

const createHarness = (): Harness => {
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const setHeader = jest.fn().mockReturnThis();

  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status, json, setHeader }),
      getRequest: () => ({ id: 'req-123', method: 'GET', url: '/api/auth/me' }),
    }),
  } as unknown as ArgumentsHost;

  return { json, status, host };
};

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('maps a thrown error code onto the structured envelope', () => {
    const { json, status, host } = createHarness();

    filter.catch(new UnauthorizedException(ERROR_CODES.AUTH_INVALID_TOKEN), host);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: ERROR_CODES.AUTH_INVALID_TOKEN,
        message: ERROR_CODES.AUTH_INVALID_TOKEN,
        details: undefined,
      },
    });
  });

  it('uses 429 for rate limiting rather than 403', () => {
    const { status, host } = createHarness();

    filter.catch(new BadRequestException(ERROR_CODES.AUTH_RATE_LIMITED), host);

    expect(status).toHaveBeenCalledWith(429);
  });

  it('turns ValidationPipe output into violations under one code', () => {
    const { json, status, host } = createHarness();

    filter.catch(
      new BadRequestException({
        message: ['phone must be a string'],
        error: 'Bad Request',
        statusCode: 400,
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0];
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_INVALID_INPUT);
    expect(body.error.details.violations).toEqual(['phone must be a string']);
  });

  it('never leaks the internal message of an unexpected error', () => {
    const { json, status, host } = createHarness();

    filter.catch(new Error('connection string: postgres://user:password@host'), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.error.code).toBe(ERROR_CODES.SYSTEM_INTERNAL_ERROR);
    expect(body.error.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('password');
  });

  it('maps a provider error object by its code', () => {
    const { status, host } = createHarness();

    filter.catch(
      Object.assign(new Error('no such provider'), { code: ERROR_CODES.PROVIDER_NOT_FOUND }),
      host,
    );

    expect(status).toHaveBeenCalledWith(404);
  });

  it('preserves the status of a plain Nest exception without a known code', () => {
    const { status, host } = createHarness();

    filter.catch(new NotFoundException('Provider config 123 not found'), host);

    expect(status).toHaveBeenCalledWith(404);
  });
});

/**
 * Regression: AUTH_CODE_EXPIRED was absent from an enumerated 401 list and so
 * fell through to 500. Every known code must map to the status its prefix
 * implies, and no client-facing failure may answer 500.
 */
describe('error code coverage', () => {
  // DB_, SECURITY_ and SYSTEM_ are server-side (500). PROVIDER_ and AI_ describe
  // an upstream dependency, so 502 is correct and asserted separately.
  const callerFacing = Object.entries(ERROR_CODES).filter(
    ([, code]) =>
      !code.startsWith('DB_') &&
      !code.startsWith('SECURITY_') &&
      !code.startsWith('SYSTEM_') &&
      !code.startsWith('PROVIDER_') &&
      !code.startsWith('AI_') &&
      code !== ERROR_CODES.PAYMENT_GATEWAY_ERROR, // upstream gateway hiccup → 502, same treaty as PROVIDER_
  );

  it.each(callerFacing)('%s maps to a 4xx status', (_name, code) => {
    const status = httpStatusForCode(code);

    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('maps rate limiting to 429, roles to 403 and other auth failures to 401', () => {
    expect(httpStatusForCode(ERROR_CODES.AUTH_RATE_LIMITED)).toBe(429);
    expect(httpStatusForCode(ERROR_CODES.AUTH_RESEND_COOLDOWN)).toBe(429);
    expect(httpStatusForCode(ERROR_CODES.AUTH_INSUFFICIENT_ROLE)).toBe(403);
    expect(httpStatusForCode(ERROR_CODES.AUTH_CODE_EXPIRED)).toBe(401);
    expect(httpStatusForCode(ERROR_CODES.AUTH_USER_NOT_FOUND)).toBe(401);
  });

  it("treats a malformed payment callback as the caller's error", () => {
    expect(httpStatusForCode(ERROR_CODES.PAYMENT_CALLBACK_INVALID)).toBe(400);
  });

  it('maps not-found codes to 404 and upstream provider failures to 502', () => {
    expect(httpStatusForCode(ERROR_CODES.PROVIDER_NOT_FOUND)).toBe(404);
    expect(httpStatusForCode(ERROR_CODES.BACKUP_NOT_FOUND)).toBe(404);
    expect(httpStatusForCode(ERROR_CODES.PROVIDER_UNAVAILABLE)).toBe(502);
    expect(httpStatusForCode(ERROR_CODES.AI_NOT_CONFIGURED)).toBe(502);
  });

  it('reserves 500 for genuine server-side failures', () => {
    expect(httpStatusForCode(ERROR_CODES.DB_QUERY_FAILED)).toBe(500);
    expect(httpStatusForCode(ERROR_CODES.SECURITY_DECRYPTION_FAILED)).toBe(500);
    expect(httpStatusForCode(ERROR_CODES.SYSTEM_INTERNAL_ERROR)).toBe(500);
  });

  it('accepts every code the codebase can emit', () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(isKnownErrorCode(code)).toBe(true);
    }
  });
});
