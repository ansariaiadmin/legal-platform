import { ConfigService } from '@nestjs/config';
import { OrchestratorService } from '../../src/modules/orchestrator/orchestrator.service';
import { ExpertRegistry } from '../../src/modules/orchestrator/expert-registry';
import { IntentClassifier, LOW_CONFIDENCE } from '../../src/modules/orchestrator/intent-classifier';
import { AgentGovernanceService } from '../../src/modules/orchestrator/agent-governance.service';
import { HybridInferenceRouter } from '../../src/modules/orchestrator/hybrid-inference-router';
import { ModelAssignmentService } from '../../src/modules/orchestrator/model-assignment.service';
import { InProcessAgentEventBus } from '../../src/modules/orchestrator/agent-event-bus';
import { LlmTiebreakerService } from '../../src/modules/orchestrator/llm-tiebreaker.service';
import { BudgetGateService } from '../../src/modules/orchestrator/budget-gate.service';
import { SessionMemoryService } from '../../src/modules/orchestrator/session-memory.service';
import { LegalExpertBaseAgent } from '@legal-platform/agent-legal-expert-base';
import { ERROR_CODES } from '@legal-platform/contracts';
import { LegalField } from '@legal-platform/domain';
import type { AIProvider } from '../../src/providers/ai/ai.provider';
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

/** Spy provider that the tests steer; calls counted, payload steered. */
function steeredAi(payloads: string[]) {
  const calls: string[] = [];
  const ai: AIProvider = {
    generateText: async ({ prompt }) => {
      calls.push(prompt);
      const text = payloads.length > 1 ? payloads.shift()! : payloads[0];
      return { text, model: 'stub-1', usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 } };
    },
    embedText: async () => ({ embedding: [], dimension: 0, model: 'stub' }),
    verifyConfig: async () => ({ valid: true }),
    getMetadata: () => ({ name: 'stub', models: ['stub-1'], capabilities: { supportsStreaming: false, maxContextLength: 4_000, supportedTasks: [] }, defaultEmbeddingDimension: 0 }),
  };
  return { ai, calls };
}

const FUTURE = new Date(Date.now() + 60 * 60_000).toISOString();

function build(opts?: { ai?: AIProvider; budgetCfg?: Record<string, unknown> }) {
  const registry = new ExpertRegistry();
  registry.register(new LegalExpertBaseAgent());
  const governance = new AgentGovernanceService();
  const router = new HybridInferenceRouter(
    new ConfigService({ AI_LOCAL_BASE_URL: '', AI_MONTHLY_BUDGET_USD: '' }),
    new ModelAssignmentService(),
  );
  const bus = new InProcessAgentEventBus();
  const tiebreaker = new LlmTiebreakerService(opts?.ai);
  const budget = new BudgetGateService(
    new ConfigService({ AI_FEATURE_QUOTA_TOKENS: JSON.stringify(opts?.budgetCfg ?? {}) }),
    memStorage(),
  );
  const service = new OrchestratorService(
    registry,
    governance,
    router,
    bus,
    new IntentClassifier(),
    undefined, // corpus shelf not under test here
    tiebreaker,
    budget,
  );
  return { service, governance, bus, budget, tiebreaker };
}

async function grantFamily(governance: AgentGovernanceService, agentId: string) {
  await governance.grant({
    agentId,
    capability: `expert:family:execute`,
    grantedBy: 'owner-1',
    expiresAt: FUTURE,
  });
}

describe('P3-T2 — bounded LLM tiebreaker (never outside providers/ai)', () => {
  it('confident queries NEVER cost a token (tiebreaker not fired)', async () => {
    const { ai, calls } = steeredAi(['{"field":"family","kind":"question"}']);
    const { service } = build({ ai });
    const t = new LlmTiebreakerService(ai);
    const c = new IntentClassifier().classify('قرارداد ملک فسخ سند');
    expect(c.confidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE);
    const r = await t.resolve('قرارداد ملک فسخ سند', c);
    expect(r.outcome).toBe('not_needed');
    expect(calls).toHaveLength(0);
    void service;
  });

  it('low-confidence + healthy provider → family wins the re-route via JSON', async () => {
    const { ai } = steeredAi(['{"field":"family","kind":"question"}']);
    const { service, governance } = build({ ai });
    await grantFamily(governance, 'legal-expert-base');
    // zero keyword overlap with the deterministic vocab → confidence 0 → tiebreak fires
    const { routing, result } = await service.dispatch({
      taskId: 'tb-1',
      query: 'با برادر دایی‌ام دچار اختلاف شخصی شده‌ام و حیرانم چه کنم',
    });
    expect(routing.classification.field).toBe(LegalField.FAMILY);
    expect((routing.classification.matchedTerms.at(-1) ?? '').startsWith('llm:')).toBe(true);
    void result;
  });

  it('garbage JSON → llm_rejected honestly, deterministic outcome kept', async () => {
    const { ai } = steeredAi(['NOT JSON AT ALL']);
    const t = new LlmTiebreakerService(ai);
    const c = new IntentClassifier().classify('قضیه غریب!');
    const r = await t.resolve('قضیه غریب!', c);
    expect(r.outcome).toBe('llm_rejected');
    expect(r.changed).toBe(false);
    expect(r.classification.field).toBe(LegalField.GENERAL);
  });

  it('out-of-enum JSON → llm_rejected (schema is LAW, not suggestion)', async () => {
    const { ai } = steeredAi(['{"field":"astrology","kind":"question"}']);
    const t = new LlmTiebreakerService(ai);
    const r = await t.resolve('???', { kind: 'unknown' as never, field: LegalField.GENERAL, confidence: 0, matchedTerms: [] });
    expect(r.outcome).toBe('llm_rejected');
    expect(r.changed).toBe(false);
  });

  it('privileged tasks never dial the LLM (secrecy law)', async () => {
    const { ai, calls } = steeredAi(['{"field":"family","kind":"question"}']);
    const t = new LlmTiebreakerService(ai);
    const c = new IntentClassifier().classify('پرونده محرمانه!');
    const r = await t.resolve('پرونده محرمانه!', c, 'privileged');
    expect(r.outcome).toBe('skipped_privileged');
    expect(calls).toHaveLength(0); // not one byte leaked
  });

  it('no provider → outcome named honestly instead of pretending', async () => {
    const t = new LlmTiebreakerService(undefined);
    const c = new IntentClassifier().classify('پرونده هول!');
    const r = await t.resolve('پرونده هول!', c);
    expect(r.outcome).toBe('unavailable');
  });
});

describe('P3-T4 — per-feature budget gate', () => {
  it('exhaustion is real math: spent ≥ quota flips predictable gates OFF', async () => {
    const { budget, service } = build({ budgetCfg: { tiebreak: 25 } });
    await budget.consume('tiebreak', { totalTokens: 20 });
    expect(await budget.check('tiebreak')).toBe(true);
    await budget.consume('tiebreak', { totalTokens: 6 });
    expect(await budget.check('tiebreak')).toBe(false);

    // and the dispatch path honours it: tiebreak never fires
    const { result } = await service.dispatch({ taskId: 'bg-1', query: 'جُرم‌زنی عجیب?!' });
    expect(result.errorCode).toBeDefined(); // no expert matched is honest — not a silent LLM spend
    expect([ERROR_CODES.AI_NO_EXPERT_MATCHED, ERROR_CODES.AI_AGENT_NOT_AUTHORIZED]).toContain(result.errorCode);
  });

  it('budget survives a fresh service instance (StorageProvider-backed)', async () => {
    const storage = memStorage();
    const cfg = new ConfigService({ AI_FEATURE_QUOTA_TOKENS: '{"tiebreak": 50}' });
    const a = new BudgetGateService(cfg, storage);
    await a.consume('tiebreak', { totalTokens: 30 });
    const b = new BudgetGateService(cfg, storage);
    expect((await b.view('tiebreak')).spentTokens).toBe(30);
  });
});

describe('P3-T3 — session memory with honest TTL', () => {
  it('remembers turns within the window and forgets after TTL (no magic memory)', async () => {
    const storage = memStorage();
    const mem = new SessionMemoryService(storage);
    mem.ttlMs = 60_000;
    await mem.remember('u1', 'lawyer', 'درباره پولِ مهریه');
    await mem.remember('u1', 'leader', 'پاسخ لیدر');

    const turns = await mem.recall('u1');
    expect(turns).toHaveLength(2);
    const lines = await mem.contextLines('u1');
    expect(lines[0]).toContain('وکیل');

    const expired = new SessionMemoryService(storage);
    expired.ttlMs = -1; // everything pre-rotten
    expect(await expired.recall('u1')).toHaveLength(0);
  });

  it('a fresh service「sees」what the dead one wrote (restart continuity)', async () => {
    const storage = memStorage();
    const a = new SessionMemoryService(storage);
    await a.remember('u9', 'leader', 'نکته مهم پرونده');
    const b = new SessionMemoryService(storage);
    const got = await b.recall('u9');
    expect(got.map((t) => t.text)).toContain('نکته مهم پرونده');
  });

  it('caps the window at MAX_TURNS — memory has manners', async () => {
    const mem = new SessionMemoryService(memStorage());
    for (let i = 0; i < 25; i++) await mem.remember('u2', 'lawyer', `حرف ${i}`);
    expect((await mem.recall('u2')).length).toBeLessThanOrEqual(10);
  });
});
