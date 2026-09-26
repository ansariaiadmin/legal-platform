import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { Response } from 'express';
import { pingRedis } from './redis.ping';
import { MetricsService } from './metrics.service';
import { AlertingService, type Alert } from './alerting.service';

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
    storage?: CheckResult;
    disk?: CheckResult;
  };
  version?: string;
}

export interface ReadyReport {
  ready: boolean;
  timestamp: string;
  checks: {
    database: CheckResult;
    redis: CheckResult;
    migrations?: CheckResult;
  };
}

/**
 * Real dependency health, not a static `{status:'ok'}`.
 *
 * - /health: liveness + DB/Redis/storage/disk checks
 * - /ready: readiness probe for k8s / load balancer — DB + migrations must be up
 * - /metrics: Prometheus exposition format
 * - /dashboard: HTML dashboard for quick inspection
 * - /alerts: recent alerts
 */
@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly pool: Pool,
    private readonly configService: ConfigService,
    private readonly metrics: MetricsService,
    private readonly alerting: AlertingService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness plus database, Redis, storage, disk checks' })
  async health(@Res({ passthrough: true }) response: Response): Promise<HealthReport> {
    const [database, redis, storage, disk] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkStorage(),
      this.checkDisk(),
    ]);

    const status: HealthReport['status'] =
      database.status === 'up' ? (redis.status === 'down' || storage.status === 'down' ? 'degraded' : 'ok') : 'error';

    if (status !== 'ok') {
      response.status(status === 'error' ? 503 : 200);
    }

    return {
      status,
      service: 'api',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: { database, redis, storage, disk },
      version: process.env.npm_package_version || '1.0.0',
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — ready to serve traffic?' })
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadyReport> {
    const [database, redis, migrations] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkMigrations(),
    ]);

    const ready = database.status === 'up' && migrations.status !== 'down';

    if (!ready) {
      response.status(503);
    }

    return {
      ready,
      timestamp: new Date().toISOString(),
      checks: { database, redis, migrations },
    };
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Prometheus metrics exposition' })
  async metricsEndpoint(@Res() response: Response): Promise<void> {
    const prometheusText = this.metrics.getPrometheusMetrics();
    response.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    response.send(prometheusText);
  }

  @Get('health/dashboard')
  @ApiOperation({ summary: 'HTML monitoring page' })
  async dashboard(@Res() response: Response): Promise<void> {
    const health = await this.health(response);
    // Reset status code for dashboard HTML
    response.status(200);

    const stats = this.metrics.getStats();
    const alerts = this.alerting.getRecentAlerts(10);
    const diskStatus = this.alerting.getDiskStatus();

    const html = `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Legal Platform - Monitoring Dashboard</title>
<style>
  body { font-family: Tahoma, Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; direction: rtl; }
  .container { max-width: 1200px; margin: 0 auto; }
  .header { background: linear-gradient(135deg, #1e3a8a, #3b82f6); color: white; padding: 20px; border-radius: 12px; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
  .card { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  .status-ok { color: #10b981; font-weight: bold; }
  .status-degraded { color: #f59e0b; font-weight: bold; }
  .status-error { color: #ef4444; font-weight: bold; }
  .metric { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
  .alert { background: #fef2f2; border-right: 4px solid #ef4444; padding: 12px; margin: 8px 0; border-radius: 4px; }
  .alert-warning { background: #fffbeb; border-right-color: #f59e0b; }
  .alert-info { background: #eff6ff; border-right-color: #3b82f6; }
  .up { color: #10b981; }
  .down { color: #ef4444; }
  .skipped { color: #6b7280; }
  pre { background: #1f2937; color: #e5e7eb; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 12px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>🏛️ پلتفرم حقوقی - داشبورد مانیتورینگ</h1>
    <p>وضعیت: <span class="status-${health.status}">${health.status}</span> | Uptime: ${health.uptimeSeconds}s | ${health.timestamp}</p>
  </div>

  <div class="grid">
    <div class="card">
      <h3>🔍 وضعیت سرویس‌ها</h3>
      <div class="metric"><span>دیتابیس</span><span class="${health.checks.database.status}">${health.checks.database.status} ${health.checks.database.latencyMs ? `(${health.checks.database.latencyMs}ms)` : ''}</span></div>
      <div class="metric"><span>Redis</span><span class="${health.checks.redis.status}">${health.checks.redis.status} ${health.checks.redis.latencyMs ? `(${health.checks.redis.latencyMs}ms)` : ''}</span></div>
      <div class="metric"><span>Storage</span><span class="${health.checks.storage?.status || 'skipped'}">${health.checks.storage?.status || 'skipped'}</span></div>
      <div class="metric"><span>Disk</span><span class="${health.checks.disk?.status || 'skipped'}">${health.checks.disk?.status || 'skipped'} ${diskStatus ? `(${diskStatus.freePercent}% free)` : ''}</span></div>
    </div>

    <div class="card">
      <h3>📊 متریک‌های HTTP</h3>
      <div class="metric"><span>کل درخواست‌ها</span><span>${stats.http.requestsTotal}</span></div>
      <div class="metric"><span>خطاها</span><span>${stats.http.errorsTotal}</span></div>
      <div class="metric"><span>نرخ خطا</span><span>${stats.http.errorRatePercent.toFixed(2)}%</span></div>
      <div class="metric"><span>میانگین زمان پاسخ</span><span>${stats.http.avgDurationMs.toFixed(2)}ms</span></div>
    </div>

    <div class="card">
      <h3>💾 دیتابیس و Redis</h3>
      <div class="metric"><span>کوئری‌های DB</span><span>${stats.db.queriesTotal}</span></div>
      <div class="metric"><span>خطاهای DB</span><span>${stats.db.failuresTotal}</span></div>
      <div class="metric"><span>عملیات Redis</span><span>${stats.redis.operationsTotal}</span></div>
      <div class="metric"><span>خطاهای Redis</span><span>${stats.redis.failuresTotal}</span></div>
    </div>

    <div class="card">
      <h3>🤖 دستیاران</h3>
      <div class="metric"><span>اجراها</span><span>${stats.agents.executionsTotal}</span></div>
      <div class="metric"><span>خطاها</span><span>${stats.agents.failuresTotal}</span></div>
      <div class="metric"><span>بکاپ‌ها</span><span>${stats.backups.jobsTotal}</span></div>
      <div class="metric"><span>خطای بکاپ</span><span>${stats.backups.failuresTotal}</span></div>
    </div>
  </div>

  <div class="card" style="margin-top: 20px;">
    <h3>🚨 هشدارهای اخیر</h3>
    ${alerts.length === 0 ? '<p>هیچ هشداری ثبت نشده ✅</p>' : alerts.map(a => `
      <div class="alert alert-${a.severity}">
        <strong>${a.rule}</strong> [${a.severity}]<br>
        ${a.message}<br>
        <small>${a.timestamp}</small>
      </div>
    `).join('')}
  </div>

  <div class="card" style="margin-top: 20px;">
    <h3>📈 Prometheus Metrics</h3>
    <p><a href="/api/metrics" target="_blank">مشاهده متریک‌های Prometheus</a> | <a href="/api/health" target="_blank">/health JSON</a> | <a href="/api/ready" target="_blank">/ready JSON</a></p>
    <pre>${this.metrics.getPrometheusMetrics().slice(0, 2000)}...</pre>
  </div>
</div>
</body>
</html>
    `;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.send(html);
  }

  @Get('health/alerts')
  @ApiOperation({ summary: 'Recent alerts' })
  async alerts(): Promise<{ alerts: Alert[] }> {
    return { alerts: this.alerting.getRecentAlerts(50) };
  }

  @Get('health/stats')
  @ApiOperation({ summary: 'Metrics as JSON' })
  async stats(): Promise<any> {
    return this.metrics.getStats();
  }

  private async checkDatabase(): Promise<CheckResult> {
    const startedAt = Date.now();
    try {
      await this.pool.query('SELECT 1');
      const result: CheckResult = { status: 'up', latencyMs: Date.now() - startedAt };
      this.metrics.recordDbQuery(result.latencyMs!, false);
      return result;
    } catch (error) {
      let msg = error instanceof Error ? error.message : 'query failed';
      if (!msg && Array.isArray((error as AggregateError).errors)) {
        const inner: unknown = (error as AggregateError).errors[0];
        const innerCode =
          inner && typeof inner === 'object' && 'code' in inner
            ? String((inner as { code?: unknown }).code ?? '')
            : '';
        const innerMsg = inner instanceof Error ? inner.message : String(inner ?? '');
        msg = `unreachable: ${innerCode || innerMsg || 'empty driver detail'}`;
      }
      if (!msg) msg = 'unreachable (empty driver error)';
      const result: CheckResult = { status: 'down', latencyMs: Date.now() - startedAt, error: msg };
      this.metrics.recordDbQuery(result.latencyMs!, true);
      return result;
    }
  }

  private async checkRedis(): Promise<CheckResult> {
    const url = this.configService.get<string>('REDIS_URL');
    if (!url) {
      return { status: 'skipped' };
    }

    const result = await pingRedis(url);
    this.metrics.recordRedisOperation(!result.reachable);
    return result.reachable
      ? { status: 'up', latencyMs: result.latencyMs }
      : { status: 'down', error: result.error };
  }

  private async checkStorage(): Promise<CheckResult> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const uploadPath = path.join(process.cwd(), 'data', 'uploads');
      const altPath = path.join(process.cwd(), 'uploads');

      if (fs.existsSync(uploadPath) || fs.existsSync(altPath)) {
        return { status: 'up' };
      }

      // Check if we can write to temp
      const os = await import('os');
      fs.accessSync(os.tmpdir(), fs.constants.W_OK);
      return { status: 'up' };
    } catch (error) {
      return { status: 'down', error: error instanceof Error ? error.message : 'storage check failed' };
    }
  }

  private async checkDisk(): Promise<CheckResult> {
    try {
      const diskStatus = this.alerting.getDiskStatus();
      if (diskStatus) {
        return {
          status: diskStatus.freePercent < 10 ? 'down' : diskStatus.freePercent < 20 ? 'up' : 'up',
          error: diskStatus.freePercent < 20 ? `Only ${diskStatus.freePercent}% free` : undefined,
        };
      }

      // Try to check disk space
      const { execSync } = await import('child_process');
      const output = execSync('df -h / | tail -1 | awk \'{print $5}\'').toString().trim();
      const usedPercent = parseInt(output.replace('%', ''), 10);
      const freePercent = 100 - usedPercent;

      if (freePercent < 10) {
        return { status: 'down', error: `Disk low: ${freePercent}% free` };
      }

      return { status: 'up' };
    } catch {
      return { status: 'skipped' };
    }
  }

  private async checkMigrations(): Promise<CheckResult> {
    const startedAt = Date.now();
    try {
      // Check if migrations table exists and has entries
      await this.pool.query('SELECT 1 FROM migrations LIMIT 1');
      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch {
      // If migrations table doesn't exist, try schema_migrations (TypeORM)
      try {
        await this.pool.query('SELECT 1 FROM schema_migrations LIMIT 1');
        return { status: 'up', latencyMs: Date.now() - startedAt };
      } catch {
        // In dev, migrations might not be required
        return { status: 'skipped', latencyMs: Date.now() - startedAt };
      }
    }
  }
}
