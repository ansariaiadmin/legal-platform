import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  ERROR_CODES,
  errorResponse,
  httpStatusForCode,
  isKnownErrorCode,
} from '@legal-platform/contracts';

/**
 * Turns every thrown value into the structured error payload mandated by
 * SPEC section 7, using the error-code prefixes of SPEC section 10.
 *
 * Conventions:
 * - Business code throws `new <Nest>Exception('PREFIX_CODE')`. The string is
 *   recognised as a known code and becomes `error.code`.
 * - Anything unknown becomes SYSTEM_INTERNAL_ERROR and its message is hidden
 *   in production so internals never leak to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();

    const { status, code, message, details } = this.normalize(exception);

    const body = errorResponse(code, message, details);

    // Structured log line (SPEC section 10): requestId, module, action, result.
    this.logger.error(
      JSON.stringify({
        requestId: request?.id ?? null,
        module: 'http',
        action: `${request?.method ?? 'UNKNOWN'} ${request?.url ?? '/'}`,
        result: 'error',
        status,
        code,
        message: this.safeMessage(exception, status),
      }),
      status >= 500 ? this.stackOf(exception) : undefined,
    );

    response
      .status(status)
      .setHeader('X-Request-Id', request?.id ?? '')
      .json(body);
  }

  private normalize(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      // `new UnauthorizedException('AUTH_INVALID_TOKEN')` -> payload is a string
      if (typeof payload === 'string') {
        return this.fromCode(payload, status);
      }

      if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;
        const rawMessage = record.message;

        // ValidationPipe produces { message: string[], error, statusCode }
        if (Array.isArray(rawMessage)) {
          return {
            status,
            code: ERROR_CODES.VALIDATION_INVALID_INPUT,
            message: 'Request validation failed',
            details: { violations: rawMessage },
          };
        }

        if (typeof rawMessage === 'string' && isKnownErrorCode(rawMessage)) {
          return this.fromCode(rawMessage, status);
        }

        if (typeof record.error === 'string' && isKnownErrorCode(record.error)) {
          return this.fromCode(record.error, status);
        }
      }

      // Nest wraps body-parser parse errors into a 400 HttpException whose
      // message is the raw parser text ('Unexpected token...') — classify the
      // truth instead of shipping 400/INTERNAL (P6-S1).
      const httpMsg = exception.message || '';
      if (status === 400 && /unexpected token|invalid json|json/i.test(httpMsg)) {
        return {
          status: 400,
          code: ERROR_CODES.VALIDATION_MALFORMED_JSON,
          message: 'Request body is not valid JSON',
        };
      }
      if (status === 413) {
        return {
          status: 413,
          code: ERROR_CODES.VALIDATION_BODY_TOO_LARGE,
          message: 'Request body exceeds the allowed size',
        };
      }

      return {
        status,
        code: ERROR_CODES.SYSTEM_INTERNAL_ERROR,
        message: exception.message || 'Request failed',
      };
    }

    // Non-HTTP throwables (provider errors, pg errors, bugs)
    const anyError = exception as { code?: string; message?: string; status?: unknown; type?: string };
    if (anyError && typeof anyError.code === 'string' && isKnownErrorCode(anyError.code)) {
      return {
        status: httpStatusForCode(anyError.code),
        code: anyError.code,
        message: anyError.message ?? 'Operation failed',
      };
    }

    // body-parser (P6-S1): malformed JSON / oversize bodies arrive as plain
    // errors carrying `status` (400/413) + `type` ('entity.parse.failed' …).
    // Before this mapping they fell through to 500 SYSTEM_INTERNAL_ERROR,
    // telling clients OUR server broke on THEIR bad payload — a lie and a
    // log-noise vector.
    const bodyStatus = typeof anyError?.status === 'number' ? anyError.status : 0;
    if (bodyStatus === 400 && anyError.type === 'entity.parse.failed') {
      return {
        status: 400,
        code: ERROR_CODES.VALIDATION_MALFORMED_JSON,
        message: 'Request body is not valid JSON',
      };
    }
    if (bodyStatus === 413 || anyError.type === 'entity.too.large') {
      return {
        status: 413,
        code: ERROR_CODES.VALIDATION_BODY_TOO_LARGE,
        message: 'Request body exceeds the allowed size',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.SYSTEM_INTERNAL_ERROR,
      message: 'Internal server error',
    };
  }

  private fromCode(code: string, fallbackStatus: number) {
    return {
      status: isKnownErrorCode(code) ? httpStatusForCode(code) : fallbackStatus,
      code: isKnownErrorCode(code) ? code : ERROR_CODES.SYSTEM_INTERNAL_ERROR,
      message: code,
    };
  }

  private safeMessage(exception: unknown, status: number): string {
    if (status < 500) return exception instanceof Error ? exception.message : String(exception);
    // Keep the real reason in the server log, never in the client payload.
    return exception instanceof Error ? exception.message : String(exception);
  }

  private stackOf(exception: unknown): string | undefined {
    return exception instanceof Error ? exception.stack : undefined;
  }
}
