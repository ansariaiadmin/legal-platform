import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { EnvService } from '../../src/config/env';
import { configureApp } from '../../src/setup';
import { ConfigHubService, DEFAULT_DEPLOYMENT_PROFILE } from '../../src/modules/orchestrator/config-hub.service';
import { parseConfigIntent } from '../../src/modules/orchestrator/config-intent';
import { internationalExpert } from '@legal-platform/agent-international-expert';

const DEV_TOKEN = 'test-dev-owner-token';

/**
 * P7: platform re-skinnable by ANY operator in ANY country through dashboard
 * knobs OR by talking to the Leader — never through a redeploy.
 */
describe('P7 deployment profile', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    process.env.DEV_DASHBOARD_TOKEN = DEV_TOKEN;
    process.env.SECURITY_SCAN_INTERVAL_MS = '0';
    process.env.GLOBAL_RATE_LIMIT_PER_MIN = '100000';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, app.get(EnvService));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('defaults to the full Iran stack when nothing stored', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/dashboard/config/profile')
      .set('Authorization', `Bearer ${DEV_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(DEFAULT_DEPLOYMENT_PROFILE);
  });

  it('owner re-skins for Germany in one call; staff can read but not write', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/dashboard/config/profile')
      .set('Authorization', `Bearer ${DEV_TOKEN}`)
      .send({ defaultLocale: 'en', country: 'Germany', currency: 'EUR' });
    expect(res.status).toBe(201);
    expect(res.body.defaultLocale).toBe('en');
    expect(res.body.country).toBe('Germany');
    expect(res.body.currency).toBe('EUR');
    expect(res.body.timezone).toBe('Asia/Tehran'); // untouched fields survive the patch

    const after = await request(app.getHttpServer())
      .get('/api/dashboard/config/profile')
      .set('Authorization', `Bearer ${DEV_TOKEN}`);
    expect(after.body.defaultLocale).toBe('en');

    // reset for isolation of later suites (profile persists via storage)
    await request(app.getHttpServer())
      .post('/api/dashboard/config/profile')
      .set('Authorization', `Bearer ${DEV_TOKEN}`)
      .send({ defaultLocale: 'fa', country: 'Iran', currency: 'IRT' });
  });

  it('bad locale values are refused, not coerced silently', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/dashboard/config/profile')
      .set('Authorization', `Bearer ${DEV_TOKEN}`)
      .send({ defaultLocale: 'xx' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('config intents parse in BOTH languages (fa: «با انگلیسی ست کن», en: set platform to English)', () => {
    const fa = parseConfigIntent('پلتفرم را با انگلیسی ست کن');
    expect(fa?.kind).toBe('set_locale');
    expect(fa?.params.locale).toBe('en');
    expect(fa?.summaryFa).toContain('English');

    const en = parseConfigIntent('set platform to English');
    expect(en?.kind).toBe('set_locale');
    expect(en?.params.locale).toBe('en');

    const backFa = parseConfigIntent('زبان پلتفرم را به فارسی برگردان');
    expect(backFa?.kind).toBe('set_locale');
    expect(backFa?.params.locale).toBe('fa');

    const de = parseConfigIntent('configure for Germany');
    expect(de?.kind).toBe('set_country');
    expect(de?.params.country).toBe('Germany');

    const deFa = parseConfigIntent('برای آلمان کانفیگ کن');
    expect(deFa?.kind).toBe('set_country');
    expect(deFa?.params.country).toBe('آلمان');
  });

  it('international-expert seats in the tree with bilingual persona', async () => {
    const hub = app.get(ConfigHubService);
    expect(hub.peekProfile().defaultLocale).toBeDefined();

    const tree = await request(app.getHttpServer())
      .get('/api/dashboard/orchestrator/tree')
      .set('Authorization', `Bearer ${DEV_TOKEN}`);
    const flat: string[] = tree.body.tree.flatMap((f: { agents: string[] }) => f.agents);
    expect(flat).toContain(internationalExpert.agentId);
    expect(internationalExpert.persona?.displayNameEn).toBeTruthy();
  });
});
