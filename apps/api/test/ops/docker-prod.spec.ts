import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Docker Production Optimization Tests — 2 tests per task
 * Checks: resource limits, logging, restart policies, volume persistence, healthchecks
 */

describe('Docker Compose Production — Optimization', () => {
  const findFile = (relativePath: string): string => {
    const candidates = [
      join(process.cwd(), relativePath),
      join(process.cwd(), '..', '..', relativePath),
      join(__dirname, '..', '..', '..', '..', relativePath),
      '/home/user/pub/legal-platform/' + relativePath,
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    return candidates[0];
  };

  const composePath = findFile('docker-compose.prod.yml');
  let rawContent: string;

  beforeAll(() => {
    expect(existsSync(composePath)).toBe(true);
    rawContent = readFileSync(composePath, 'utf8');
  });

  it('has resource limits (CPU/memory) for all services', () => {
    expect(rawContent).toContain('resources:');
    expect(rawContent).toContain('limits:');
    expect(rawContent).toContain('cpus:');
    expect(rawContent).toContain('memory:');
    expect(rawContent).toContain('reservations:');
    // Check each service has limits
    expect(rawContent.match(/limits:/g)!.length).toBeGreaterThanOrEqual(5); // at least 5 services
  });

  it('has logging configuration (file+stdout json-file)', () => {
    expect(rawContent).toContain('logging:');
    expect(rawContent).toContain('json-file');
    expect(rawContent).toContain('max-size:');
    expect(rawContent).toContain('max-file:');
  });

  it('has restart policies for all services', () => {
    expect(rawContent).toContain('restart:');
    // Should be unless-stopped or always
    expect(rawContent).toMatch(/restart:\s+(unless-stopped|always)/);
    const restartMatches = rawContent.match(/restart:\s+(unless-stopped|always)/g);
    expect(restartMatches!.length).toBeGreaterThanOrEqual(6);
  });

  it('has volume persistence for postgres, redis, uploads', () => {
    expect(rawContent).toContain('postgres_data:');
    expect(rawContent).toContain('redis_data:');
    expect(rawContent).toContain('uploads:');
    expect(rawContent).toContain('volumes:');
  });

  it('has healthchecks for all services', () => {
    expect(rawContent).toContain('healthcheck:');
    const healthcheckMatches = rawContent.match(/healthcheck:/g);
    expect(healthcheckMatches!.length).toBeGreaterThanOrEqual(6); // all 6 main services
    expect(rawContent).toContain('test:');
    expect(rawContent).toContain('interval:');
    expect(rawContent).toContain('timeout:');
    expect(rawContent).toContain('retries:');
  });

  it('has proper network configuration', () => {
    expect(rawContent).toContain('legal-network');
    expect(rawContent).toContain('networks:');
  });

  it('api service has required env vars for monitoring and backup', () => {
    // Check for monitoring env vars
    expect(rawContent).toContain('TELEGRAM_BOT_TOKEN');
    expect(rawContent).toContain('SLACK_WEBHOOK_URL');
    expect(rawContent).toContain('S3_BUCKET');
    expect(rawContent).toContain('BACKUP_ENCRYPTION_KEY');
  });
});

describe('Prometheus and Monitoring Infra', () => {
  const findFile = (relativePath: string): string => {
    const candidates = [
      join(process.cwd(), relativePath),
      join(process.cwd(), '..', '..', relativePath),
      join(__dirname, '..', '..', '..', '..', relativePath),
      '/home/user/pub/legal-platform/' + relativePath,
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    return candidates[0];
  };

  it('prometheus config exists with alert rules', () => {
    const promPath = findFile('infra/prometheus/prometheus.yml');
    const alertPath = findFile('infra/prometheus/alert.rules.yml');

    expect(existsSync(promPath)).toBe(true);
    expect(existsSync(alertPath)).toBe(true);

    const promContent = readFileSync(promPath, 'utf8');
    expect(promContent).toContain('legal-api');
    expect(promContent).toContain('/api/metrics');
    expect(promContent).toContain('alert.rules.yml');

    const alertContent = readFileSync(alertPath, 'utf8');
    expect(alertContent).toContain('HighErrorRate');
    expect(alertContent).toContain('DatabaseConnectionFailures');
    expect(alertContent).toContain('DiskSpaceLow');
    expect(alertContent).toContain('AgentFailuresHigh');
  });
});
