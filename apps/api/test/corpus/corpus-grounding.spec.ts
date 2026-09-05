import { ConfigService } from '@nestjs/config';
import { CorpusService } from '../../src/modules/corpus/corpus.service';
import { DataValidatorService } from '../../src/modules/corpus/data-validator.service';
import { LawUpdaterService } from '../../src/modules/corpus/law-updater.service';
import { OrchestratorService } from '../../src/modules/orchestrator/orchestrator.service';
import { ExpertRegistry } from '../../src/modules/orchestrator/expert-registry';
import { IntentClassifier } from '../../src/modules/orchestrator/intent-classifier';
import { AgentGovernanceService } from '../../src/modules/orchestrator/agent-governance.service';
import { HybridInferenceRouter } from '../../src/modules/orchestrator/hybrid-inference-router';
import { ModelAssignmentService } from '../../src/modules/orchestrator/model-assignment.service';
import { InProcessAgentEventBus } from '../../src/modules/orchestrator/agent-event-bus';
import { LegalExpertBaseAgent } from '@legal-platform/agent-legal-expert-base';
import type { StorageProvider } from '../../src/providers/storage/storage.provider';
import { createHash } from 'node:crypto';

function memStorage(): StorageProvider {
  const store = new Map<string, Buffer>();
  return {
    put: async ({ key, content }) => {
      store.set(key, Buffer.isBuffer(content) ? content : Buffer.from(content));
    },
    get: async (key) => {
      const v = store.get(key);
      if (!v) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return v;
    },
    delete: async (key) => void store.delete(key),
    list: async () => [...store.keys()],
    verifyConfig: async () => true,
    getMetadata: async () => null,
  };
}

const LAW_BODY =
  'قانون مدنی جمهوری اسلامی ایران که در اجرای مصوبه مجلس شورای اسلامی به تصویب رسید ' +
  'و در روزنامه رسمی منتشر شد. ' +
  'ماده ۲۱۹ - عقد عبارت است از تعلق عاطل به قابل تحت التزام قرارداد معین بین دو شخص به نحوی که مستلزم معامله باشد. '.repeat(6) +
  'ماده ۱۹۰ - برای عقد قرارداد، شرایط اساسی شامل اهلیت طرفین و قصد انعقاد و معین بودن موضوع است. قرارداد ملک و قرارداد اجاره تابع همین قواعد است. ';

describe('P2 corpus — shelf, validator tick, temporal update, grounding', () => {
  let corpus: CorpusService;
  const validator = new DataValidatorService();

  beforeEach(async () => {
    corpus = new CorpusService(memStorage());
  });

  it('ingests a law with dedup-by-sha256 and NEVER self-verifies', async () => {
    const a = await corpus.ingestDocument({
      sourceKey: 'rooznameh',
      canonicalTitle: 'قانون مدنی',
      bodyRaw: LAW_BODY,
      trustTier: 1,
      ingestedBy: 'bot',
    });
    const b = await corpus.ingestDocument({
      sourceKey: 'rooznameh',
      canonicalTitle: 'قانون مدنی',
      bodyRaw: LAW_BODY,
      trustTier: 1,
      ingestedBy: 'bot',
    });
    expect(b.documentId).toBe(a.documentId); // one shelf slot, not two
    expect(a.verifiedAt).toBeNull();
    expect(
      createHash('sha256').update(LAW_BODY, 'utf8').digest('hex'),
    ).toBe(a.sha256);
  });

  it('search default hides unverified; validator tick flips it on', async () => {
    const doc = await corpus.ingestDocument({
      sourceKey: 'rooznameh',
      canonicalTitle: 'قانون مدنی',
      bodyRaw: LAW_BODY,
      trustTier: 1,
      ingestedBy: 'bot',
    });
    expect((await corpus.search('قرارداد ملک و شرایط عقد')).map((h) => h.documentId)).toEqual([]);

    const outcome = await validator.validate({
      sourceUrl: doc.sourceKey,
      fetchedAt: doc.ingestedAt,
      contentSha256: doc.sha256,
      rawText: LAW_BODY,
      trustTier: 1,
    });
    expect(outcome.verified).toBe(true);

    await corpus.markVerified(doc.documentId, 'lawyer-1');
    const hits = await corpus.search('قرارداد ملک و شرایط عقد');
    expect(hits[0]?.documentId).toBe(doc.documentId);
    expect(hits[0]?.trustTier).toBe(1);
  });

  it('validator REJECTS: too-short text, spoofed sha, tier-1 without official marker', async () => {
    const bad = await validator.validate({
      sourceUrl: 'x',
      fetchedAt: new Date().toISOString(),
      contentSha256: 'spoofed',
      rawText: 'قانون کوتاه',
      trustTier: 1,
    });
    expect(bad.verified).toBe(false);
    expect(bad.reasons.length).toBeGreaterThanOrEqual(3);

    const UNOFFICIAL =
      'شرحی دربارهٔ قرارداد ملک که در یک وبلاگ عمومی کپی شده است. عقد یعنی توافق دو طرف ' +
      'و شرایط آن اهلیت و قصد و معین بودن موضوع است. انتقال سند با تنظیم فرم انجام می‌شود. '.repeat(6);
    const tier1WithoutMarker = await validator.validate({
      sourceUrl: 'x',
      fetchedAt: new Date().toISOString(),
      contentSha256: createHash('sha256').update(UNOFFICIAL, 'utf8').digest('hex'),
      rawText: UNOFFICIAL,
      trustTier: 1,
    });
    expect(tier1WithoutMarker.verified).toBe(false);
  });

  it('updater supersedes temporally — old version retires, shelf history survives', async () => {
    const updater = new LawUpdaterService(corpus);
    const first = await updater.applyUpdate({
      canonicalTitle: 'قانون مدنی',
      bodyRaw: LAW_BODY,
      sourceKey: 'rooznameh',
      trustTier: 1,
      ingestedBy: 'bot',
    });
    expect(first.changed).toBe(true);

    const again = await updater.applyUpdate({
      canonicalTitle: 'قانون مدنی',
      bodyRaw: LAW_BODY, // same sha → honest "no change", no fake version
      sourceKey: 'rooznameh',
      trustTier: 1,
      ingestedBy: 'bot',
    });
    expect(again.changed).toBe(false);

    const revised = await updater.applyUpdate({
      canonicalTitle: 'قانون مدنی',
      bodyRaw: LAW_BODY + '\nماده اصلاحی ۱۱۴۰ — اضافه‌شده در اصلاحیه جدید.',
      sourceKey: 'rooznameh',
      trustTier: 1,
      ingestedBy: 'bot',
    });
    expect(revised.changed).toBe(true);
    expect(revised.supersededId).toBe(revised.supersededId);
    expect(revised.document?.supersedes).toBe(first.document?.documentId);
  });

  it('grounding: dispatch carries meta.citations ONLY on real verified hits', async () => {
    // shelf a verified civil-law doc
    const doc = await corpus.ingestDocument({
      sourceKey: 'rooznameh',
      canonicalTitle: 'قانون مدنی',
      bodyRaw: LAW_BODY,
      trustTier: 1,
      ingestedBy: 'bot',
    });
    await corpus.markVerified(doc.documentId, 'lawyer-1');

    const registry = new ExpertRegistry();
    registry.register(new LegalExpertBaseAgent());
    const governance = new AgentGovernanceService();
    const router = new HybridInferenceRouter(
      new ConfigService({ AI_LOCAL_BASE_URL: '', AI_MONTHLY_BUDGET_USD: '' }),
      new ModelAssignmentService(),
    );
    const bus = new InProcessAgentEventBus();
    const service = new OrchestratorService(registry, governance, router, bus, new IntentClassifier(), corpus);
    await governance.grant({
      agentId: 'legal-expert-base',
      capability: 'expert:civil:execute',
      grantedBy: 'owner-1',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const { result } = await service.dispatch({
      taskId: 'g-1',
      query: 'قرارداد ملک و شرایط عقد',
    });
    expect(result.ok).toBe(true);
    const meta = result.meta as { grounded?: boolean; citations?: Array<{ title: string }> };
    expect(meta.grounded).toBe(true);
    expect(meta.citations![0].title).toBe('قانون مدنی');

    // no verified match → no grounding costume (early routes also stay bare)
    const noHit = await service.dispatch({
      taskId: 'g-2',
      query: 'تبادل سهام و تحلیل بورس', // outside any shelved content
    });
    const noHitMeta = noHit.result.meta as { grounded?: boolean; citations?: unknown } | undefined;
    expect(noHitMeta?.grounded).toBeFalsy();
    expect(noHitMeta?.citations).toBeUndefined();
  });
});
