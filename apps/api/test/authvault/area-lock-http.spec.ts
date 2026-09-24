import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AppModule } from '../../src/app.module';
import { EnvService } from '../../src/config/env';
import { configureApp } from '../../src/setup';
import { ERROR_CODES } from '@legal-platform/contracts';

const DEV = 'test-dev-owner-token';

/**
 * P8-T2 HTTP enforcement: with the config area LOCKED, even a valid session
 * cookie gets 401 until a real X-Area-Ticket rides along — then writes pass.
 * Isolated storage (tmp dir) so the lock never leaks into sibling suites.
 */
describe('P8 area lock over HTTP (config surface)', () => {
  let app: INestApplication;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lp-p8-http-'));
    process.env.NODE_ENV = 'development';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.DEV_DASHBOARD_TOKEN = DEV;
    process.env.LOCAL_STORAGE_PATH = dir;
    process.env.SECURITY_SCAN_INTERVAL_MS = '0';
    process.env.GLOBAL_RATE_LIMIT_PER_MIN = '100000';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, app.get(EnvService));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('unlocked by default → profile writes pass', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/dashboard/config/profile')
      .set('Authorization', `Bearer ${DEV}`)
      .send({ country: 'Testland' });
    expect(res.status).toBe(201);
  });

  it('once locked: 401 without ticket, 201 with the ticket the unlock minted', async () => {
    await request(app.getHttpServer())
      .post('/api/dashboard/vault/areas/config/password')
      .set('Authorization', `Bearer ${DEV}`)
      .send({ password: 'lock-me-now' });

    const denied = await request(app.getHttpServer())
      .post('/api/dashboard/config/profile')
      .set('Authorization', `Bearer ${DEV}`)
      .send({ country: 'Nope' });
    expect(denied.status).toBe(401);
    expect(denied.body?.error?.code).toBe(ERROR_CODES.AUTH_INVALID_CREDENTIALS);

    const wrong = await request(app.getHttpServer())
      .post('/api/dashboard/vault/areas/config/unlock')
      .set('Authorization', `Bearer ${DEV}`)
      .send({ password: 'nope-wrong' });
    expect(wrong.status).toBe(401);

    const unlock = await request(app.getHttpServer())
      .post('/api/dashboard/vault/areas/config/unlock')
      .set('Authorization', `Bearer ${DEV}`)
      .send({ password: 'lock-me-now' });
    expect(unlock.status).toBe(201);

    const allowed = await request(app.getHttpServer())
      .post('/api/dashboard/config/profile')
      .set('Authorization', `Bearer ${DEV}`)
      .set('X-Area-Ticket', unlock.body.ticket)
      .send({ country: 'Testland-2' });
    expect(allowed.status).toBe(201);
    expect(allowed.body.country).toBe('Testland-2');
  });
});
