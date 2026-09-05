import { ConfigService } from '@nestjs/config';
import { LeaderConversationService } from '../../src/modules/orchestrator/leader-conversation.service';
import { FileIntelligenceService } from '../../src/modules/orchestrator/file-intelligence.service';
import { PlacementService } from '../../src/modules/orchestrator/placement.service';
import { LeaderVoiceService } from '../../src/modules/orchestrator/leader-voice.service';
import { OrchestratorService } from '../../src/modules/orchestrator/orchestrator.service';
import { ExpertRegistry } from '../../src/modules/orchestrator/expert-registry';
import { IntentClassifier } from '../../src/modules/orchestrator/intent-classifier';
import { AgentGovernanceService } from '../../src/modules/orchestrator/agent-governance.service';
import { HybridInferenceRouter } from '../../src/modules/orchestrator/hybrid-inference-router';
import { ModelAssignmentService } from '../../src/modules/orchestrator/model-assignment.service';
import { InProcessAgentEventBus } from '../../src/modules/orchestrator/agent-event-bus';
import { PythonWorkerService } from '../../src/modules/orchestrator/python-worker.service';
import type { StorageProvider } from '../../src/providers/storage/storage.provider';
import { LegalExpertBaseAgent } from '@legal-platform/agent-legal-expert-base';
import { civilExpert } from '@legal-platform/agent-civil-expert';

const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const OWNER = { id: 'owner-1', role: 'lawyer_owner' };

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
    delete: async (key) => {
      store.delete(key);
    },
    list: async () => [...store.keys()],
    verifyConfig: async () => true,
    getMetadata: async () => null,
  };
}

const offlinePyj = () => ({
  enqueue: async () => ({ jobId: 'x', queued: false, reason: 'queue_unreachable' }),
  result: async () => null,
  ping: async () => false,
}) as unknown as PythonWorkerService;

async function bootstrap() {
  const registry = new ExpertRegistry();
  registry.register(civilExpert);
  registry.register(new LegalExpertBaseAgent());
  const governance = new AgentGovernanceService();
  await governance.grant({ agentId: 'civil-expert', capability: 'expert:civil:execute', grantedBy: 'spec', expiresAt: FUTURE });
  await governance.grant({ agentId: 'legal-leader', capability: 'expert:general:execute', grantedBy: 'spec', expiresAt: FUTURE });
  const router = new HybridInferenceRouter(
    new ConfigService({ AI_LOCAL_BASE_URL: '', AI_MONTHLY_BUDGET_USD: '' }),
    new ModelAssignmentService(),
  );
  const bus = new InProcessAgentEventBus();
  const orchestrator = new OrchestratorService(registry, governance, router, bus, new IntentClassifier());
  const files = new FileIntelligenceService(memStorage(), offlinePyj());
  const voice = new LeaderVoiceService();
  const conversations = new LeaderConversationService(orchestrator, voice, files, new PlacementService(registry), bus);
  return { conversations, files, orchestrator, governance, bus, voice };
}

describe('Leader conversation — THE sandbox (P1e / ADR-013)', () => {
  it('reads the file FIRST, then answers and recommends placement', async () => {
    const { conversations, files } = await bootstrap();
    const rec = await files.register(
      {
        originalname: 'اجاره-نامه.txt',
        mimetype: 'text/plain',
        size: 0,
        buffer: Buffer.from('قرارداد اجاره فروشگاه: مستأجر متعهد است اجاره را تا پنجم هر ماه بپردازد'),
      },
      OWNER.id,
    );
    const conv = conversations.open(OWNER.id);
    const reply = await conversations.chat(
      { conversationId: conv.conversationId, text: 'این سند چیست؟', fileIds: [rec.fileId] },
      OWNER,
    );
    expect(reply.text).toContain('اجاره-نامه');
    expect(reply.text).toContain('خواندم');
    expect(reply.placements[0].suggestion.agentId).toBe('civil-expert');
    expect(reply.placements[0].suggestion.collection).toBe('contracts');
    expect(reply.routing.agentId).toBe('civil-expert');
  });

  it('answer is grounded in FILE CONTEXT: routed agent sees the excerpt', async () => {
    const { conversations, files, orchestrator } = await bootstrap();
    const rec = await files.register(
      {
        originalname: 'شرط-جزایی.txt',
        mimetype: 'text/plain',
        size: 0,
        buffer: Buffer.from('بند ۹: ضرر و زیان تاخیر روزانه یک درصدم اجاره خواهد بود'),
      },
      OWNER.id,
    );
    const spy = jest.spyOn(orchestrator, 'dispatch');
    const conv = conversations.open(OWNER.id);
    await conversations.chat(
      { conversationId: conv.conversationId, text: 'شرط جزایی چیست؟', fileIds: [rec.fileId] },
      OWNER,
    );
    const task = spy.mock.calls[0][0];
    expect(task.context?.some((c: string) => c.includes('ضرر و زیان تاخیر'))).toBe(true);
    expect(task.context?.some((c: string) => c.includes('شرط-جزایی.txt'))).toBe(true);
  });

  it('conversation state: turns persist, owner-scoped listing', async () => {
    const { conversations } = await bootstrap();
    const mine = conversations.open(OWNER.id);
    const other = conversations.open('someone-else');
    await conversations.chat({ conversationId: mine.conversationId, text: 'سلام' }, OWNER);
    const after = conversations.get(mine.conversationId)!;
    expect(after.turns).toHaveLength(2); // lawyer + leader
    expect(conversations.listByOwner(OWNER.id).map((c) => c.conversationId)).toContain(mine.conversationId);
    expect(conversations.listByOwner(OWNER.id).map((c) => c.conversationId)).not.toContain(other.conversationId);
  });

  it('cannot resurrect someone else’s conversation', async () => {
    const { conversations } = await bootstrap();
    const other = conversations.open('someone-else');
    await expect(conversations.chat({ conversationId: other.conversationId, text: 'hi' }, OWNER)).rejects.toThrow(
      'another user',
    );
  });

  it('voice-chat: transcript → full chat → SPOKEN reply (text carried through)', async () => {
    const { conversations, voice } = await bootstrap();
    const conv = conversations.open(OWNER.id);
    const voiceSession = voice.openSession();
    const result = await conversations.voiceChat(
      {
        sessionId: voiceSession.sessionId,
        conversationId: conv.conversationId,
        transcriptHint: 'فسخ قرارداد اجاره چطور انجام میشه؟',
      },
      OWNER,
    );
    expect(result.heardText).toContain('قرارداد اجاره');
    expect(result.reply.routing.agentId).toBe('civil-expert');
    expect(result.speech.mocked).toBe(true);
    expect(result.speech.mimeType).toBeDefined();
    // and the voice session remembers that the LEADER spoke THIS reply
    const stored = voice.getSession(voiceSession.sessionId)!;
    const leaderTurns = stored.turns.filter((t) => t.role === 'leader');
    expect(leaderTurns.at(-1)!.text).toBe(result.reply.text);
  });

  it('trims history at the cap without crashing', async () => {
    const { conversations } = await bootstrap();
    const conv = conversations.open(OWNER.id);
    for (let i = 0; i < 60; i++) {
      await conversations.chat({ conversationId: conv.conversationId, text: `پیام ${i}` }, OWNER);
    }
    expect(conversations.get(conv.conversationId)!.turns.length).toBeLessThanOrEqual(100);
  });
});
