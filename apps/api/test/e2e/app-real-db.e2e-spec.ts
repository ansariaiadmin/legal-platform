import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { EnvService } from '../../src/config/env';
import { configureApp } from '../../src/setup';

/**
 * Boots the full application against a real database (skipped when
 * DATABASE_URL is not set). The agent and signature scenarios that need no
 * database live in test/orchestrator/lawyer-scenarios.spec.ts.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

if (!databaseUrl) {
  console.warn('[e2e] DATABASE_URL not set; skipping the real-database suite');
}

describeWithDb('Application against a real database', () => {
  let app: INestApplication;
  let pool: Pool;
  let http: Parameters<typeof request>[0];

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_ACCESS_SECRET = 'e2e-access-secret-lawyer';
    process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret-lawyer';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, app.get(EnvService));
    await app.init();

    http = app.getHttpServer();
    pool = app.get(Pool);
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  describe('Health', () => {
    it('GET /api/health returns 200 with dependency checks', async () => {
      const res = await request(http).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.checks.database.status).toBe('up');
    });
  });
});
