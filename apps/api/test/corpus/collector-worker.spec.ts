import { CollectorAgentService } from '../../src/modules/corpus/collector-agent.service';
import { CorpusService } from '../../src/modules/corpus/corpus.service';
import { DataValidatorService } from '../../src/modules/corpus/data-validator.service';
import { IngestionWorkerService } from '../../src/modules/corpus/ingestion-worker.service';
import type { StorageProvider } from '../../src/providers/storage/storage.provider';

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

describe('P2 — collector mock fixtures → worker state machine → diagnostics', () => {
  function buildSuite() {
    const corpus = new CorpusService(memStorage());
    const collector = new CollectorAgentService();
    const worker = new IngestionWorkerService(memStorage(), collector, corpus, new DataValidatorService());
    return { corpus, collector, worker };
  }

  it('mock collector yields 2 real fixtures and counts the wire-failure honestly', async () => {
    const { collector } = buildSuite();
    const run = await collector.collect({
      taskId: 't',
      query: 'sync',
      context: ['rooznameh-mock', '1405-06-15'],
    });
    expect(run.attempted).toBe(3);
    expect(run.succeeded).toBe(2);
    expect(run.failed).toBe(1);
    expect(run.items.every((i) => i.trustTier === 1)).toBe(true);
    expect(run.items.every((i) => i.sourceUrl.startsWith('mock://rooznameh-mock/1405-06-15'))).toBe(true);
  });

  it('worker run shelves fixtures, auto-verifies tier-1-with-marker, lands partial_success on a mixed window', async () => {
    const { worker, corpus } = buildSuite();
    const job = await worker.sync('rooznameh-mock', '1405-06-15');

    expect(job.status).toBe('partial_success'); // 1 fixture FAIL wire — the honest middle state
    expect(job.attempted).toBe(3);
    expect(job.succeeded).toBe(2);
    expect(job.failed).toBe(1);
    expect(job.documentIds).toHaveLength(2);

    // validator passed them: tier-1 fixtures carry the official marker
    const docs = await corpus.list();
    expect(docs).toHaveLength(2);
    expect(docs.every((d) => d.verifiedAt !== null)).toBe(true);
  });

  it('same (source, window) is IDEMPOTENT: replaying sync does not double-shelve nor double-run', async () => {
    const { worker, corpus } = buildSuite();
    const a = await worker.sync('rooznameh-mock', '1405-06-15');
    const b = await worker.sync('rooznameh-mock', '1405-06-15');

    expect(b.jobId).toBe(a.jobId);
    expect(b).toEqual(expect.objectContaining({ status: 'partial_success', succeeded: 2 }));
    expect((await corpus.list()).length).toBe(2); // dedupe held across replays
  });

  it('manual RETRY on a failure-visible job re-counts fresh and link-fixes the run', async () => {
    const { worker, corpus } = buildSuite();
    const first = await worker.sync('rooznameh-mock', '1405-06-15');
    expect((await worker.failures()).map((j) => j.jobId)).toContain(first.jobId); // diagnostics sees it

    const retried = await worker.retry(first.jobId);
    expect(retried).not.toBeNull();
    expect(retried!.jobId).toBe(first.jobId); // same key, same row — truth not multiplied
    expect(retried!.retryOf).toBe(first.jobId);
    expect(retried!.status).toBe('partial_success'); // fixture FAIL is deterministic — honest result repeats
    expect(retried!.documentIds).toHaveLength(2);
    expect((await corpus.list()).length).toBe(2);
  });

  it('different windows each get their own job; tomorrow ORIGINAL-sync supersedes nothing when bodies match', async () => {
    const { worker } = buildSuite();
    const today = await worker.sync('rooznameh-mock', '1405-06-15');
    const tomorrow = await worker.sync('rooznameh-mock', '1405-06-16');
    expect(tomorrow.jobId).not.toBe(today.jobId);
    // same bodies but titles are window-stamped → two NEW titles per run:
    // shelf grows honestly, never by hiding a window
    const jobs = await worker.list();
    expect(jobs).toHaveLength(2);
  });
});
