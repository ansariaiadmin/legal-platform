import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from '../../src/app.module';
import { EnvService } from '../../src/config/env';
import { configureApp } from '../../src/setup';

/**
 * P5-T1 coverage contract: every major surface of the platform shows up in
 * the generated OpenAPI document under its /api prefix — if a route exists
 * but Swagger can't see it, it's private plumbing with a public address,
 * which this test calls out.
 */
describe('OpenAPI completeness (P5-T1)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_ACCESS_SECRET = 'test-openapi-secret';
    process.env.JWT_REFRESH_SECRET = 'test-openapi-secret';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, app.get(EnvService));
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('exposes corpus / rag / machine-tokens / queue / client routes in the document', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('legal-platform').setVersion('test').build(),
    );
    const paths = Object.keys(doc.paths);

    const required = [
      // P2 corpus & ingestion
      '/dashboard/corpus/stats',
      '/dashboard/corpus/documents',
      '/dashboard/corpus/documents/{id}/verify',
      '/dashboard/corpus/sync',
      '/dashboard/corpus/jobs/{id}/retry',
      '/dashboard/corpus/diagnostics',
      // P4 drafting
      '/dashboard/rag/drafts',
      '/dashboard/rag/drafts/{id}/generate',
      '/dashboard/rag/drafts/{id}/review',
      '/dashboard/rag/usage/monthly',
      // P5 surface
      '/dashboard/machine-tokens',
      '/ext/ping',
      // P3 orchestration dry-run trace
      '/dashboard/orchestrator/dry-run',
      '/dashboard/orchestrator/budget',
      // P2a client commerce
      '/client/catalog',
      '/client/queue/join',
      // P6 security plane
      '/dashboard/security/posture',
      '/dashboard/security/standards',
      '/dashboard/security/reports/latest',
      '/dashboard/security/scan',
      '/dashboard/security/schedule',
      // P8 surfaces
      '/dashboard/vault/areas',
      '/dashboard/vault/rotation/advice',
      '/dashboard/vault/rotation/rotate-all',
      '/dashboard/setup',
      '/dashboard/ops/backup',
      '/dashboard/ops/deployment',
    ];

    const missing = required.filter((p) => !paths.some((x) => x === p || x === `/api${p}`));
    expect(missing).toEqual([]);
  });

  it('tags the public surfaces so generated SDKs self-organize', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('legal-platform').setVersion('test').build(),
    );
    const ops = Object.values(doc.paths).flatMap((p) => Object.values(p as Record<string, { tags?: string[]; summary?: string }>));
    const tagged = new Set(ops.flatMap((o) => o.tags ?? []));
    for (const t of ['corpus', 'rag', 'machine-tokens', 'ext', 'orchestrator', 'security', 'vault', 'setup', 'ops']) {
      expect([...tagged]).toContain(t);
    }
  });
});
