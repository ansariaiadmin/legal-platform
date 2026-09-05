import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { Response } from 'express';
import { pingRedis } from './redis.ping';

type CheckStatus = 'up' | 'down' | 'skipped';

interface CheckResult {
  status: CheckStatus;
  latencyMs?: number;
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'error';
  service: 'api';
  uptimeSeconds: number;
  timestamp: string;
  checks: {
    database: CheckResult;
    redis: CheckResult;
  };
}

/**
 * Real dependency health, not a static `{status:'ok'}`.
 *
 * `database` is required: if it is down the endpoint answers 503 and the
 * overall status is `error`. `redis` is reported but non-fatal until the queue
 * layer actually depends on it (SPEC section 11 jobs are not implemented yet).
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly pool: Pool,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness plus database and Redis checks' })
  async health(@Res({ passthrough: true }) response: Response): Promise<HealthReport> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);

    const status: HealthReport['status'] =
      database.status === 'up' ? (redis.status === 'down' ? 'degraded' : 'ok') : 'error';

    if (status !== 'ok') {
      response.status(status === 'error' ? 503 : 200);
    }

    return {
      status,
      service: 'api',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: { database, redis },
    };
  }

  private async checkDatabase(): Promise<CheckResult> {
    const startedAt = Date.now();
    try {
      await this.pool.query('SELECT 1');
      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch (error) {
      // P11: AggregateError (pg-pool's no-host wrapper) ships an EMPTY
      // message — a blank error is how support tickets get expensive.
      let msg = error instanceof Error ? error.message : 'query failed';
      if (!msg && Array.isArray((error as AggregateError).errors)) {
        const inner = (error as AggregateError).errors[0];
        msg = inner instanceof Error ? `unreachable: ${inner.code ?? inner.message}` : 'unreachable';
      }
      if (!msg) msg = 'unreachable (empty driver error)';
      return { status: 'down', latencyMs: Date.now() - startedAt, error: msg };
    }
  }

  private async checkRedis(): Promise<CheckResult> {
    const url = this.configService.get<string>('REDIS_URL');
    if (!url) {
      return { status: 'skipped' };
    }

    const result = await pingRedis(url);
    return result.reachable
      ? { status: 'up', latencyMs: result.latencyMs }
      : { status: 'down', error: result.error };
  }
}
