import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { EnvService } from '../../src/config/env';
import { configureApp } from '../../src/setup';

/**
 * Regression test for the failure that stopped the API from starting at all:
 *
 *   Nest can't resolve dependencies of the AuthService
 *   (BoundPool, JwtService, AuditService, ?).
 *   Please make sure that the argument Object at index [3] is available...
 *
 * `SmsProvider` is an interface, so the emitted design:paramtypes entry was
 * `Object`; adapters are now injected through their category tokens.
 *
 * Building the graph needs no live database - `pg.Pool` connects lazily - so
 * this catches wiring regressions on every run.
 */
describe('Application bootstrap', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, app.get(EnvService));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('resolves the complete dependency graph', () => {
    expect(app).toBeDefined();
  });

  it('serves routes under the /api prefix and nowhere else', async () => {
    const server = app.getHttpServer();

    // The DTO validator rejects the phone before any database access happens.
    const prefixed = await request(server).post('/api/auth/otp/request').send({ phone: 'nope' });
    expect(prefixed.status).toBe(400);
    expect(prefixed.body.error.code).toBe('VALIDATION_INVALID_INPUT');

    const unprefixed = await request(server).post('/auth/otp/request').send({ phone: 'nope' });
    expect(unprefixed.status).toBe(404);
  });

  it('returns the structured error envelope with a request id header', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/otp/request')
      .send({ phone: 'nope' });

    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(response.body.success).toBe(false);
  });
});
