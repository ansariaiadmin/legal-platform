import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitService, RateLimitRule } from './rate-limit.service';
import { Request } from 'express';

export const ENDPOINT_RATE_LIMIT_KEY = 'endpoint_rate_limit';

export interface EndpointRateLimitConfig {
  limit: number;
  windowMs: number;
  keyBy: 'ip' | 'user' | 'ip+user';
  message?: string;
}

/**
 * Per-endpoint rate limiting guard.
 * Supports:
 * - login: 5/min/IP
 * - upload: 10/hour/user
 * - API: 1000/hour/user
 */
export const EndpointRateLimit = (config: EndpointRateLimitConfig) => {
  return (target: any, propertyKey?: string, descriptor?: PropertyDescriptor) => {
    Reflect.defineMetadata(ENDPOINT_RATE_LIMIT_KEY, config, descriptor?.value || target);
    return descriptor;
  };
};

@Injectable()
export class EndpointRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const config = this.reflector.get<EndpointRateLimitConfig>(
      ENDPOINT_RATE_LIMIT_KEY,
      context.getHandler(),
    );

    if (!config) {
      return true; // No rate limit configured
    }

    const request = context.switchToHttp().getRequest<Request & { user?: any; ip: string }>();
    const key = this.buildKey(request, config, context);

    const rule: RateLimitRule = {
      limit: config.limit,
      windowMs: config.windowMs,
    };

    const decision = this.rateLimitService.consume(key, rule);

    if (!decision.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: config.message || 'Too many requests',
          error: 'Rate limit exceeded',
          retryAfter: decision.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private buildKey(request: Request & { user?: any }, config: EndpointRateLimitConfig, context: ExecutionContext): string {
    const handler = context.getHandler().name;
    const controller = context.getClass().name;

    switch (config.keyBy) {
      case 'ip':
        return `endpoint:${controller}:${handler}:ip:${request.ip}`;
      case 'user':
        const userId = request.user?.id || request.user?.sub || 'anonymous';
        return `endpoint:${controller}:${handler}:user:${userId}`;
      case 'ip+user':
        const uid = request.user?.id || request.user?.sub || 'anonymous';
        return `endpoint:${controller}:${handler}:ip:${request.ip}:user:${uid}`;
      default:
        return `endpoint:${controller}:${handler}:ip:${request.ip}`;
    }
  }
}

// Predefined rate limit configs per task requirements
export const RateLimitPresets = {
  // Login: 5/min/IP
  LOGIN: {
    limit: 5,
    windowMs: 60 * 1000,
    keyBy: 'ip' as const,
    message: 'تعداد تلاش ورود بیش از حد مجاز است. لطفا یک دقیقه صبر کنید',
  },
  // Upload: 10/hour/user
  UPLOAD: {
    limit: 10,
    windowMs: 60 * 60 * 1000,
    keyBy: 'user' as const,
    message: 'تعداد آپلود بیش از حد مجاز است. لطفا یک ساعت صبر کنید',
  },
  // API: 1000/hour/user
  API: {
    limit: 1000,
    windowMs: 60 * 60 * 1000,
    keyBy: 'user' as const,
    message: 'تعداد درخواست API بیش از حد مجاز است',
  },
  // Strict: 20/min/IP for sensitive endpoints
  STRICT: {
    limit: 20,
    windowMs: 60 * 1000,
    keyBy: 'ip' as const,
    message: 'تعداد درخواست بیش از حد مجاز',
  },
};
