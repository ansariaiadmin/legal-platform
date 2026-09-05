import { EvolutionService } from '../../src/modules/orchestrator/evolution.service';
import { ExpertRegistry } from '../../src/modules/orchestrator/expert-registry';
import { AgentGovernanceService } from '../../src/modules/orchestrator/agent-governance.service';
import { InProcessAgentEventBus } from '../../src/modules/orchestrator/agent-event-bus';
import type { AgentEvent } from '@legal-platform/shared';

const VALID = {
  agentId: 'tax-expert',
  field: 'commercial',
  displayName: 'کارشناس ارشد امور مالیاتی',
  motto: 'سند مالیاتی گمشده یعنی جریمهٔ دوباره.',
  spawnedBy: 'owner-1',
  skills: [{
    id: 'tax:audit-review',
    description: 'بررسی اظهارنامه‌ها',
    terms: ['اظهارنامه', 'مالیات', 'بخشنامه', 'سود مشمول مالیات'],
  }],
};

function build() {
  const registry = new ExpertRegistry();
  const governance = new AgentGovernanceService();
  const bus = new InProcessAgentEventBus();
  const events: AgentEvent[] = [];
  bus.subscribe((e) => events.push(e));
  return { registry, governance, bus, events, service: new EvolutionService(registry, bus) };
}

describe('EvolutionService — the Leader grows the society (ADR-009)', () => {
  it('spawns a valid member and registers it in the fleet', () => {
    const { registry, service } = build();
    const result = service.spawn(VALID);
    expect(result.agentId).toBe('tax-expert');
    expect(registry.get('tax-expert')).toBeDefined();
    expect(registry.get('tax-expert')!.persona?.displayName).toContain('مالیاتی');
  });

  it('spawned member starts with ZERO grants (society law) — dispatch denied', async () => {
    const { governance, service } = build();
    service.spawn(VALID);
    const decision = await governance.check('tax-expert', 'expert:commercial:execute');
    expect(decision).toEqual({ allowed: false, reason: 'no_grant' });
  });

  it('spawned member obeys society laws from birth (ADR-007)', () => {
    const { registry, service } = build();
    service.spawn(VALID);
    const agent = registry.get('tax-expert')!;
    expect(agent.requiresReview).toBe(true);
    expect(agent.version).toMatch(/-spawned$/);
  });

  it('spawned member answers honestly ungrounded', async () => {
    const { registry, service } = build();
    service.spawn(VALID);
    const r = await registry.get('tax-expert')!.executeExpert({ taskId: 'x', query: 'اظهارنامه مالیات بر ارزش افزوده' });
    expect(r.meta?.grounded).toBe(false);
    expect(r.meta?.routedSkillId).toBe('tax:audit-review');
  });

  it('rejects malformed agentId (must end with -expert)', () => {
    const { service } = build();
    expect(() => service.spawn({ ...VALID, agentId: 'Tax Expert!' })).toThrow(/kebab-case/);
  });

  it('rejects unknown legal field', () => {
    const { service } = build();
    expect(() => service.spawn({ ...VALID, field: 'astrology' })).toThrow(/field must be one of/);
  });

  it('rejects skills with too few vocabulary terms (routing would starve)', () => {
    const { service } = build();
    expect(() =>
      service.spawn({ ...VALID, skills: [{ id: 'tax:x', description: 'x', terms: ['a', 'b'] }] }),
    ).toThrow(/≥3/);
  });

  it('rejects duplicate agent ids loudly', () => {
    const { service } = build();
    service.spawn(VALID);
    expect(() => service.spawn(VALID)).toThrow(/already exists/);
  });

  it('announces the birth on the live event stream', () => {
    const { events, service } = build();
    service.spawn(VALID);
    expect(events.some((e) => e.agentId === 'tax-expert' && e.detail?.includes('spawned'))).toBe(true);
  });

  it('retire removes only spawned members — core fleet is protected', () => {
    const { registry, service } = build();
    service.spawn(VALID);
    expect(service.retire('tax-expert', 'owner-1')).toBe(true);
    expect(registry.get('tax-expert')).toBeUndefined();
    // core member has version '0.1.0' (no -spawned suffix) → protected
    registry.register({
      kind: 'expert', agentId: 'civil-expert', version: '0.1.0', field: 'civil',
      subspecialties: [], requiresReview: true,
      capabilities: () => [], health: async () => ({ healthy: true }),
      route: async () => null, execute: async () => ({ ok: true, output: '' }),
      executeExpert: async () => ({ ok: true, output: '' }),
    });
    expect(service.retire('civil-expert', 'owner-1')).toBe(false);
    expect(registry.get('civil-expert')).toBeDefined();
  });
});
