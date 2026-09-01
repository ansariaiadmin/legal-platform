import { ArgumentsHost, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AllExceptionsFilter } from '../../src/common/all-exceptions.filter';
import { ERROR_CODES } from '@legal-platform/contracts';

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
