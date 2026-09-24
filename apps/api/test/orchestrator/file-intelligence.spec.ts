import { FileIntelligenceService } from '../../src/modules/orchestrator/file-intelligence.service';
import { PythonWorkerService } from '../../src/modules/orchestrator/python-worker.service';
import type { StorageProvider } from '../../src/providers/storage/storage.provider';
import { PlacementService } from '../../src/modules/orchestrator/placement.service';
import { ExpertRegistry } from '../../src/modules/orchestrator/expert-registry';
import { LegalExpertBaseAgent } from '@legal-platform/agent-legal-expert-base';
import { civilExpert } from '@legal-platform/agent-civil-expert';
import { criminalExpert } from '@legal-platform/agent-criminal-expert';
import { familyExpert } from '@legal-platform/agent-family-expert';
import { registrationExpert } from '@legal-platform/agent-registration-expert';

function buildRegistry() {
  const registry = new ExpertRegistry();
  for (const e of [civilExpert, criminalExpert, familyExpert, registrationExpert, new LegalExpertBaseAgent()]) {
    registry.register(e);
  }
  return registry;
}

const memStorage = () => {
  const store = new Map<string, Buffer>();
  const provider: StorageProvider = {
    put: async ({ key, content }) => {
      store.set(key, Buffer.isBuffer(content) ? content : Buffer.from(content));
    },
    get: async (key) => {
      const v = store.get(key);
      if (!v) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return v;
    },
    delete: async (key) => {
      store.delete(key);
    },
    list: async () => [...store.keys()],
    verifyConfig: async () => true,
    getMetadata: async () => null,
  };
  return provider;
};

const offlinePyj = () => ({
  enqueue: async () => ({ jobId: 'x', queued: false, reason: 'queue_unreachable' }),
  result: async () => null,
  ping: async () => false,
}) as unknown as PythonWorkerService;

describe('file intelligence (P1e)', () => {
  it('registers ANY file into Storage and sha256s it', async () => {
    const fi = new FileIntelligenceService(memStorage(), offlinePyj());
    const rec = await fi.register(
      { originalname: 'قرارداد اجاره.txt', mimetype: 'text/plain', size: 21, buffer: Buffer.from('اجاره نامه فروشگاه', 'utf8') },
      'u1',
    );
    expect(rec.sha256).toHaveLength(64);
    expect(rec.fileId).toHaveLength(16);
    expect(rec.storageKey).toContain('uploads/');
  });

  it('queue down → honest INLINE pre-read for text, never invented content', async () => {
    const fi = new FileIntelligenceService(memStorage(), offlinePyj());
    const rec = await fi.register(
      { originalname: 'سند.txt', mimetype: 'text/plain', size: 0, buffer: Buffer.from('ماده ۱۰ قانون مدنی: عقد لازم است') },
      'u1',
    );
    const analyzed = await fi.analyze(rec.fileId);
    expect(analyzed.analysis!.status).toBe('completed_inline');
    expect(analyzed.analysis!.preview).toContain('قانون مدنی');
    expect(analyzed.analysis!.languageHint).toBe('fa');
  });

  it('binary offline → digest only, no hallucinated text', async () => {
    const fi = new FileIntelligenceService(memStorage(), offlinePyj());
    const rec = await fi.register(
      { originalname: 'scan.pdf', mimetype: 'application/pdf', size: 8, buffer: Buffer.from('%PDF-1.4') },
      'u1',
    );
    const analyzed = await fi.analyze(rec.fileId);
    expect(analyzed.analysis!.kindGuess).toBe('pdf');
    expect(analyzed.analysis!.preview).toBe('');
  });

  it('listByUser scopes files to their uploader', async () => {
    const fi = new FileIntelligenceService(memStorage(), offlinePyj());
    await fi.register({ originalname: 'a.txt', mimetype: 'text/plain', size: 1, buffer: Buffer.from('a') }, 'u1');
    await fi.register({ originalname: 'b.txt', mimetype: 'text/plain', size: 1, buffer: Buffer.from('b') }, 'u2');
    expect(fi.listByUser('u1')).toHaveLength(1);
    expect(fi.listByUser('nobody')).toHaveLength(0);
  });
});

describe('placement advisor (P1e)', () => {
  it('suggests the skill whose vocabulary best matches the file content', async () => {
    const registry = buildRegistry();
    const placement = new PlacementService(registry);
    const fi = new FileIntelligenceService(memStorage(), offlinePyj());
    const rec = await fi.register(
      {
        originalname: 'قرارداد.txt',
        mimetype: 'text/plain',
        size: 0,
        buffer: Buffer.from('قرارداد اجاره موردی عقد تمدید شرط ضمانت ماده ۱۰ قانون مدنی تعهد'),
      },
      'u1',
    );
    await fi.analyze(rec.fileId);
    const suggestion = await placement.suggest(rec);
    expect(suggestion.agentId).not.toBeNull();
    expect(suggestion.skillId).toBe('civil:contracts');
    expect(suggestion.collection).toBe('contracts');
    expect(suggestion.score).toBeGreaterThan(0);
  });

  it('unmatched file → needs-review instead of a lie', async () => {
    const registry = buildRegistry();
    const placement = new PlacementService(registry);
    const fi = new FileIntelligenceService(memStorage(), offlinePyj());
    const rec = await fi.register(
      { originalname: 'random.bin', mimetype: 'application/octet-stream', size: 4, buffer: Buffer.from([0, 1, 2, 3]) },
      'u1',
    );
    await fi.analyze(rec.fileId);
    const suggestion = await placement.suggest(rec);
    expect(suggestion.agentId).toBeNull();
    expect(suggestion.collection).toBe('needs-review');
  });
});
