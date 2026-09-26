import { Injectable } from '@nestjs/common';

/**
 * Prometheus metrics collector (lightweight, no external prom-client dependency
 * required for basic operation — we emit OpenMetrics text format manually).
 * Tracks HTTP requests, error rates, DB/Redis latency, agent failures.
 *
 * For production with prom-client, you can replace this with prom-client
 * counters, but this implementation is dependency-free and auditable.
 */

@Injectable()
export class MetricsService {
  private httpRequestsTotal = 0;
  private httpErrorsTotal = 0;
  private httpRequestDurationSum = 0;
  private httpRequestDurationCount = 0;

  private dbQueryDurationSum = 0;
  private dbQueryDurationCount = 0;
  private dbFailuresTotal = 0;

  private redisOperationsTotal = 0;
  private redisFailuresTotal = 0;

  private agentExecutionsTotal = 0;
  private agentFailuresTotal = 0;
  private agentFailuresByAgent = new Map<string, number>();

  private backupJobsTotal = 0;
  private backupFailuresTotal = 0;

  // Per-endpoint counters
  private endpointCounters = new Map<string, { total: number; errors: number; durationSum: number }>();

  private startTime = Date.now();

  // HTTP metrics
  recordHttpRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    this.httpRequestsTotal++;
    this.httpRequestDurationSum += durationMs;
    this.httpRequestDurationCount++;

    if (statusCode >= 400) {
      this.httpErrorsTotal++;
    }

    const key = `${method} ${route}`;
    const existing = this.endpointCounters.get(key) || { total: 0, errors: 0, durationSum: 0 };
    existing.total++;
    if (statusCode >= 400) existing.errors++;
    existing.durationSum += durationMs;
    this.endpointCounters.set(key, existing);
  }

  recordDbQuery(durationMs: number, failed: boolean): void {
    this.dbQueryDurationSum += durationMs;
    this.dbQueryDurationCount++;
    if (failed) this.dbFailuresTotal++;
  }

  recordRedisOperation(failed: boolean): void {
    this.redisOperationsTotal++;
    if (failed) this.redisFailuresTotal++;
  }

  recordAgentExecution(agentId: string, failed: boolean): void {
    this.agentExecutionsTotal++;
    if (failed) {
      this.agentFailuresTotal++;
      const current = this.agentFailuresByAgent.get(agentId) || 0;
      this.agentFailuresByAgent.set(agentId, current + 1);
    }
  }

  recordBackupJob(failed: boolean): void {
    this.backupJobsTotal++;
    if (failed) this.backupFailuresTotal++;
  }

  getErrorRate(): number {
    if (this.httpRequestsTotal === 0) return 0;
    return (this.httpErrorsTotal / this.httpRequestsTotal) * 100;
  }

  // Prometheus exposition format
  getPrometheusMetrics(): string {
    const lines: string[] = [];
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    lines.push('# HELP legal_platform_uptime_seconds Application uptime in seconds');
    lines.push('# TYPE legal_platform_uptime_seconds gauge');
    lines.push(`legal_platform_uptime_seconds ${uptimeSeconds}`);
    lines.push('');

    lines.push('# HELP legal_platform_http_requests_total Total HTTP requests');
    lines.push('# TYPE legal_platform_http_requests_total counter');
    lines.push(`legal_platform_http_requests_total ${this.httpRequestsTotal}`);
    lines.push('');

    lines.push('# HELP legal_platform_http_errors_total Total HTTP errors (4xx, 5xx)');
    lines.push('# TYPE legal_platform_http_errors_total counter');
    lines.push(`legal_platform_http_errors_total ${this.httpErrorsTotal}`);
    lines.push('');

    const errorRate = this.getErrorRate();
    lines.push('# HELP legal_platform_http_error_rate_percent HTTP error rate percentage');
    lines.push('# TYPE legal_platform_http_error_rate_percent gauge');
    lines.push(`legal_platform_http_error_rate_percent ${errorRate.toFixed(2)}`);
    lines.push('');

    lines.push('# HELP legal_platform_http_request_duration_seconds_sum Sum of HTTP request durations');
    lines.push('# TYPE legal_platform_http_request_duration_seconds_sum counter');
    lines.push(`legal_platform_http_request_duration_seconds_sum ${(this.httpRequestDurationSum / 1000).toFixed(3)}`);
    lines.push('');

    lines.push('# HELP legal_platform_http_request_duration_seconds_count Count of HTTP requests measured');
    lines.push('# TYPE legal_platform_http_request_duration_seconds_count counter');
    lines.push(`legal_platform_http_request_duration_seconds_count ${this.httpRequestDurationCount}`);
    lines.push('');

    if (this.httpRequestDurationCount > 0) {
      const avg = this.httpRequestDurationSum / this.httpRequestDurationCount;
      lines.push('# HELP legal_platform_http_request_duration_avg_ms Average HTTP request duration');
      lines.push('# TYPE legal_platform_http_request_duration_avg_ms gauge');
      lines.push(`legal_platform_http_request_duration_avg_ms ${avg.toFixed(2)}`);
      lines.push('');
    }

    lines.push('# HELP legal_platform_db_query_duration_seconds_sum Sum of DB query durations');
    lines.push('# TYPE legal_platform_db_query_duration_seconds_sum counter');
    lines.push(`legal_platform_db_query_duration_seconds_sum ${(this.dbQueryDurationSum / 1000).toFixed(3)}`);
    lines.push('');

    lines.push('# HELP legal_platform_db_failures_total Total DB connection/query failures');
    lines.push('# TYPE legal_platform_db_failures_total counter');
    lines.push(`legal_platform_db_failures_total ${this.dbFailuresTotal}`);
    lines.push('');

    lines.push('# HELP legal_platform_redis_operations_total Total Redis operations');
    lines.push('# TYPE legal_platform_redis_operations_total counter');
    lines.push(`legal_platform_redis_operations_total ${this.redisOperationsTotal}`);
    lines.push('');

    lines.push('# HELP legal_platform_redis_failures_total Total Redis failures');
    lines.push('# TYPE legal_platform_redis_failures_total counter');
    lines.push(`legal_platform_redis_failures_total ${this.redisFailuresTotal}`);
    lines.push('');

    lines.push('# HELP legal_platform_agent_executions_total Total agent executions');
    lines.push('# TYPE legal_platform_agent_executions_total counter');
    lines.push(`legal_platform_agent_executions_total ${this.agentExecutionsTotal}`);
    lines.push('');

    lines.push('# HELP legal_platform_agent_failures_total Total agent failures');
    lines.push('# TYPE legal_platform_agent_failures_total counter');
    lines.push(`legal_platform_agent_failures_total ${this.agentFailuresTotal}`);
    lines.push('');

    for (const [agentId, count] of this.agentFailuresByAgent) {
      lines.push(`legal_platform_agent_failures_total{agent="${agentId}"} ${count}`);
    }
    if (this.agentFailuresByAgent.size > 0) lines.push('');

    lines.push('# HELP legal_platform_backup_jobs_total Total backup jobs');
    lines.push('# TYPE legal_platform_backup_jobs_total counter');
    lines.push(`legal_platform_backup_jobs_total ${this.backupJobsTotal}`);
    lines.push('');

    lines.push('# HELP legal_platform_backup_failures_total Total backup failures');
    lines.push('# TYPE legal_platform_backup_failures_total counter');
    lines.push(`legal_platform_backup_failures_total ${this.backupFailuresTotal}`);
    lines.push('');

    // Per-endpoint
    for (const [endpoint, stats] of this.endpointCounters) {
      const safeEndpoint = endpoint.replace(/"/g, '\\"');
      lines.push(`legal_platform_http_endpoint_requests_total{endpoint="${safeEndpoint}"} ${stats.total}`);
      lines.push(`legal_platform_http_endpoint_errors_total{endpoint="${safeEndpoint}"} ${stats.errors}`);
    }
    if (this.endpointCounters.size > 0) lines.push('');

    return lines.join('\n') + '\n';
  }

  getStats(): Record<string, any> {
    return {
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      http: {
        requestsTotal: this.httpRequestsTotal,
        errorsTotal: this.httpErrorsTotal,
        errorRatePercent: this.getErrorRate(),
        avgDurationMs: this.httpRequestDurationCount > 0 ? this.httpRequestDurationSum / this.httpRequestDurationCount : 0,
      },
      db: {
        queriesTotal: this.dbQueryDurationCount,
        failuresTotal: this.dbFailuresTotal,
        avgDurationMs: this.dbQueryDurationCount > 0 ? this.dbQueryDurationSum / this.dbQueryDurationCount : 0,
      },
      redis: {
        operationsTotal: this.redisOperationsTotal,
        failuresTotal: this.redisFailuresTotal,
      },
      agents: {
        executionsTotal: this.agentExecutionsTotal,
        failuresTotal: this.agentFailuresTotal,
        failuresByAgent: Object.fromEntries(this.agentFailuresByAgent),
      },
      backups: {
        jobsTotal: this.backupJobsTotal,
        failuresTotal: this.backupFailuresTotal,
      },
      endpoints: Object.fromEntries(this.endpointCounters),
    };
  }

  reset(): void {
    this.httpRequestsTotal = 0;
    this.httpErrorsTotal = 0;
    this.httpRequestDurationSum = 0;
    this.httpRequestDurationCount = 0;
    this.dbQueryDurationSum = 0;
    this.dbQueryDurationCount = 0;
    this.dbFailuresTotal = 0;
    this.redisOperationsTotal = 0;
    this.redisFailuresTotal = 0;
    this.agentExecutionsTotal = 0;
    this.agentFailuresTotal = 0;
    this.agentFailuresByAgent.clear();
    this.backupJobsTotal = 0;
    this.backupFailuresTotal = 0;
    this.endpointCounters.clear();
    this.startTime = Date.now();
  }
}
