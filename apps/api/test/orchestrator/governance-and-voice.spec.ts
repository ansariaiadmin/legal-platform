import { AgentGovernanceService } from '../../src/modules/orchestrator/agent-governance.service';
import { LeaderVoiceService, MockVoiceEngine } from '../../src/modules/orchestrator/leader-voice.service';

describe('AgentGovernanceService (ADR-005)', () => {
  const FUTURE = new Date(Date.now() + 3600_000).toISOString();
  const PAST = new Date(Date.now() - 3600_000).toISOString();

  it('no grant => denied with reason no_grant', async () => {
    const g = new AgentGovernanceService();
    const d = await g.check('legal-expert-base', 'expert:civil:execute');
    expect(d).toEqual({ allowed: false, reason: 'no_grant' });
  });

  it('active grant => allowed and returns the grant', async () => {
    const g = new AgentGovernanceService();
    await g.grant({
      agentId: 'legal-expert-base',
      capability: 'expert:civil:execute',
      grantedBy: 'owner',
      expiresAt: FUTURE,
    });
    const d = await g.check('legal-expert-base', 'expert:civil:execute');
    expect(d.allowed).toBe(true);
  });

  it('expired grant => denied', async () => {
    const g = new AgentGovernanceService();
    await g.grant({
      agentId: 'legal-expert-base',
      capability: 'expert:civil:execute',
      grantedBy: 'owner',
      expiresAt: PAST,
    });
    expect((await g.check('legal-expert-base', 'expert:civil:execute'))).toEqual({
      allowed: false,
      reason: 'expired',
    });
  });

  it('disabled agent overrides even an active grant', async () => {
    const g = new AgentGovernanceService();
    await g.grant({
      agentId: 'legal-expert-base',
      capability: 'expert:civil:execute',
      grantedBy: 'owner',
      expiresAt: FUTURE,
    });
    g.setDisabled('legal-expert-base', true);
    expect((await g.check('legal-expert-base', 'expert:civil:execute'))).toEqual({
      allowed: false,
      reason: 'disabled',
    });
  });

  it('grants never leak across agents', async () => {
    const g = new AgentGovernanceService();
    await g.grant({
      agentId: 'legal-expert-base',
      capability: 'expert:civil:execute',
      grantedBy: 'owner',
      expiresAt: FUTURE,
    });
    expect((await g.check('someone-else', 'expert:civil:execute')).allowed).toBe(false);
  });
});

describe('LeaderVoiceService (SPEC §11a voice channel)', () => {
  it('opens a session on the mock engine, honestly flagged', async () => {
    const voice = new LeaderVoiceService(new MockVoiceEngine());
    const session = voice.openSession();
    expect(session.engine).toBe('mock-voice');
    expect(await voice.engineHealth()).toBe(true);
  });

  it('a voice turn records manager + leader turns in order', async () => {
    const voice = new LeaderVoiceService(new MockVoiceEngine());
    const { sessionId } = voice.openSession();
    await voice.hear(sessionId, Buffer.alloc(0), 'سلام، وضعیت پرونده‌ها چطوره؟');
    const spoken = await voice.speak(sessionId, 'همه‌چیز تحت کنترل است.');
    const session = voice.getSession(sessionId)!;
    expect(session.turns.map((t) => t.role)).toEqual(['manager', 'leader']);
    expect(spoken.mocked).toBe(true); // never pretends to be real audio
  });

  it('unknown session id throws (no silent no-op)', async () => {
    const voice = new LeaderVoiceService(new MockVoiceEngine());
    await expect(voice.speak('nope', 'x')).rejects.toThrow(/not found/);
  });
});
