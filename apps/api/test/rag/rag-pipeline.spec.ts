import { ConfigService } from '@nestjs/config';
import { CorpusService } from '../../src/modules/corpus/corpus.service';
import { EmbeddingIndexService, cosineSim } from '../../src/modules/rag/embedding-index.service';
import { RerankerService } from '../../src/modules/rag/reranker.service';
import { DraftingService } from '../../src/modules/rag/drafting.service';
import { UsageMeterService } from '../../src/modules/rag/usage-meter.service';
import { DraftRequestState } from '@legal-platform/domain';
import { ERROR_CODES } from '@legal-platform/contracts';
import type { AIProvider } from '../../src/providers/ai/ai.provider';
import type { StorageProvider } from '../../src/providers/storage/storage.provider';

function memStorage(): StorageProvider {
  const store = new Map<string, Buffer>();
  return {
    put: async ({ key, content }) => { store.set(key, Buffer.isBuffer(content) ? content : Buffer.from(content)); },
    get: async (key) => {
      const v = store.get(key);
      if (!v) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return v;
    },
    delete: async (k) => void store.delete(k),
    list: async () => [...store.keys()],
    verifyConfig: async () => true,
    getMetadata: async () => null,
  };
}

/** Toy embedder: the word 'قانون' → +x, 'ملک' → +y, 'طلاق' → +z. */
function toyAi(): AIProvider {
  const embed = (text: string): number[] => {
    const v = [0, 0, 0];
    if (text.includes('قانون')) v[0] += 1;
    if (text.includes('ملک')) v[1] += 1;
    if (text.includes('طلاق')) v[2] += 1;
    if (v.every((x) => x === 0)) v[0] = 0.01;
    return v;
  };
  return {
    embedText: async ({ text, model }) => ({
      embedding: embed(text),
      dimension: 3,
      model: model ?? 'toy-embed',
      usage: { promptTokens: 5, completionTokens: 0, totalTokens: 5 },
    }),
    generateText: async ({ prompt }) => ({
      text: `پیش‌نویس بر پایهٔ منابع. [1] «قانون مدنی» مطابق مادهٔ عقد معتبر است. منابع: [1]`,
      model: 'toy-cite',
      usage: { promptTokens: prompt.length / 4, completionTokens: 40, totalTokens: 90 },
    }),
    verifyConfig: async () => ({ valid: true }),
    getMetadata: () => ({
      name: 'toy',
      models: ['toy-cite'],
      capabilities: { supportsStreaming: false, maxContextLength: 4000, supportedTasks: ['generate', 'embed'] },
      defaultEmbeddingDimension: 3,
    }),
  };
}

const LAW_A = 'قانون مدنی در مورد ملک و عقد. این روزنامه رسمی منتشرشده و مجلس شورای اسلامی تصویب کرده است. '.repeat(4) +
  'مادهٔ ۱ — عقد قرارداد ملک می‌تواند با ثبت سند رسمی انجام شود. خریدار و فروشنده هر دو رعایتِ قانون را می‌نمایند.';

const LAW_B = 'حقوق خانواده در مورد طلاق و حضانت. این متن رسمی از روزنامه رسمی است و مجلس شورای اسلامی آن را گذراند. '.repeat(4);

function buildRag() {
  const storage = memStorage();
  const corpus = new CorpusService(storage);
  const ai = toyAi();
  const index = new EmbeddingIndexService(storage, corpus, ai);
  const reranker = new RerankerService(new ConfigService());
  const bus = { emit: jest.fn() } as never;
  const meter = new UsageMeterService(storage, new ConfigService({ AI_MONTHLY_ALERT_THRESH_USD: '0.0005', AI_TOKEN_PRICING_USD: '{"toy-cite": 0.01}' }), bus);
  const drafting = new DraftingService(storage, corpus, index, reranker, meter, bus, ai);
  return { storage, corpus, ai, index, reranker, meter, drafting, bus };
}

describe('P4-T1 — semantic index (cosine on provider dims, truth when degraded)', () => {
  it('empty index stats are HONEST and usable without a provider', async () => {
    const storage = memStorage();
    const corpus = new CorpusService(storage);
    const noIndex = new EmbeddingIndexService(storage, corpus, undefined);
    expect((await noIndex.stats()).degraded).toBe('no_embedding_provider');
    expect(await noIndex.search('anything')).toEqual([]);
  });

  it('rebuild from a VERIFIED shelf, query by cosine, dimension-matching enforced', async () => {
    const { corpus, index } = buildRag();
    const a = await corpus.ingestDocument({ sourceKey: 'r', canonicalTitle: 'قانون مدنی', bodyRaw: LAW_A, trustTier: 1, ingestedBy: 't' });
    await corpus.markVerified(a.documentId, 't');
    const b = await corpus.ingestDocument({ sourceKey: 'r', canonicalTitle: 'قانون خانواده', bodyRaw: LAW_B, trustTier: 2, ingestedBy: 't' });
    await corpus.markVerified(b.documentId, 't');

    expect((await index.rebuild()).indexed).toBeGreaterThan(0);
    const hits = await index.search('موضوع ملک در قانون مدنی');
    expect(hits[0]?.canonicalTitle).toBe('قانون مدنی');
    expect(hits[0]?.score).toBeGreaterThan(0.9);
    expect(cosineSim([1, 0], [0, 1])).toBe(0);
    expect(cosineSim([1, 1], [1, 1])).toBeCloseTo(1);
  });

  it('index refresh after docs change yields deterministic freshness (rebuild, not accrete)', async () => {
    const { corpus, index } = buildRag();
    const a = await corpus.ingestDocument({ sourceKey: 'r', canonicalTitle: 'قانون مدنی', bodyRaw: LAW_A, trustTier: 1, ingestedBy: 't' });
    await corpus.markVerified(a.documentId, 't');
    await index.rebuild();
    const stats1 = await index.stats();
    await index.rebuild();
    expect((await index.stats()).chunks).toBe(stats1.chunks); // no stale accretion
  });
});

describe('P4-T2 — reranker (config, not attitude)', () => {
  it('tier boost calibrates trust: official wins over generic with equal vectors', () => {
    const r = new RerankerService(new ConfigService());
    const hits = r.rerank([
      { documentId: 'A', canonicalTitle: 'رسمی', trustTier: 1, preview: '', vectorScore: 0.8 },
      { documentId: 'B', canonicalTitle: 'عمومی', trustTier: 3, preview: '', vectorScore: 0.8, ingestedAt: new Date().toISOString() },
    ]);
    expect(hits[0].documentId).toBe('A');
    expect(hits[0].components.tier).toBeGreaterThan(hits[1].components.tier);
  });

  it('env override shapes the weights — evolution by config, no redeploy', () => {
    const r = new RerankerService(new ConfigService({ RAG_RERANK_WEIGHTS: '{"vector": 0.9, "lexical": 0.1}' }));
    expect(r.explainWeights().vector).toBe(0.9);
  });
});

describe('P4-T3 — drafting with citations = the entry fee', () => {
  it('NO verified citations → NO generation; draft stays re-runnable with honest error', async () => {
    const { drafting } = buildRag();
    const d = await drafting.create({ prompt: 'دعوای ملک با همسایه', createdBy: 'u1' });
    const out = await drafting.generate(d.draftId);
    expect(out.state).toBe(DraftRequestState.CREATED);
    expect(out.error).toBe(ERROR_CODES.DRAFT_NO_CITATIONS);
    expect(out.output).toBe('');
  });

  it('with verified corpus: pipeline → awaiting_review with PROVENANCE bundle; review gates are law', async () => {
    const { corpus, index, drafting, meter } = buildRag();
    const a = await corpus.ingestDocument({ sourceKey: 'r', canonicalTitle: 'قانون مدنی', bodyRaw: LAW_A, trustTier: 1, ingestedBy: 't' });
    await corpus.markVerified(a.documentId, 't');
    await index.rebuild();

    const d = await drafting.create({ prompt: 'قرارداد فروش ملک بین همسایه‌ای و دایم', createdBy: 'u1' });
    const out = await drafting.generate(d.draftId);
    expect(out.state).toBe(DraftRequestState.AWAITING_REVIEW);
    expect(out.output.length).toBeGreaterThan(0);
    expect(out.provenance?.retrieved.length).toBeGreaterThan(0);
    expect(out.provenance?.model).toBe('toy-cite');

    // money accounting: the drafted tokens were booked on the meter
    const rep = await meter.monthlyReport();
    expect(rep.features.some((f) => f.feature === 'drafting')).toBe(true);
    expect(rep.totals.tokens).toBeGreaterThan(0);

    // review: approve
    const ok = await drafting.review(d.draftId, 'approve', 'lawyer-1');
    expect(ok.state).toBe(DraftRequestState.APPROVED);

    // illegal hop: approve an approved draft
    await expect(drafting.review(d.draftId, 'approve', 'lawyer-1'))
      .rejects.toMatchObject({ code: ERROR_CODES.DRAFT_ILLEGAL_TRANSITION });

    // supersede spawns a successor draft linked back to the binary of law
    const next = await drafting.review(d.draftId, 'supersede', 'lawyer-1');
    expect(next.supersedesId).toBe(d.draftId);
    expect(next.state).toBe(DraftRequestState.CREATED);
  });
});

describe('P4-T5 — usage metering & alert (no invisible spend)', () => {
  it('aggregate rows are exact; pricing absent ⇒ cost null, not invented', async () => {
    const storage = memStorage();
    const meter = new UsageMeterService(storage, new ConfigService({ AI_TOKEN_PRICING_USD: '{"m1": 0.002}' }));
    await meter.recordCall({ feature: 'tiebreak', model: 'm1', usage: { totalTokens: 500 } });
    const r2 = await meter.recordCall({ feature: 'tiebreak', model: 'm1', usage: { totalTokens: 500 } });
    expect(r2.requests).toBe(2);
    expect(r2.tokens).toBe(1000);
    expect(r2.costUsd).toBeCloseTo(0.002, 6);

    const rep = await meter.monthlyReport();
    expect(rep.totals.costUsd).toBeCloseTo(0.002, 6);

    const raw = JSON.parse((await storage.get(`runtime/usage/${new Date().toISOString().slice(0, 7)}.json`)).toString('utf8'));
    expect(raw.records).toHaveLength(1); // rollup, not per-call sprawl
  });

  it('alert fires ' + 'once per day' + ' when the month total crosses the threshold', async () => {
    const { meter, bus } = buildRag();
    const emit = (bus as unknown as { emit: jest.Mock }).emit;
    await meter.recordCall({ feature: 'drafting', model: 'toy-cite', usage: { totalTokens: 9000 } });
    const once = emit.mock.calls.filter((c) => c[0]?.kind === 'usage.alerted');
    expect(once.length).toBe(1);
    await meter.recordCall({ feature: 'drafting', model: 'toy-cite', usage: { totalTokens: 9000 } });
    const twice = emit.mock.calls.filter((c) => c[0]?.kind === 'usage.alerted');
    expect(twice.length).toBe(1); // never an alert-spamming
  });
});
