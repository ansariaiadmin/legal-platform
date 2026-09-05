import { ConfigService } from '@nestjs/config';
import { SecurityAuditService, type SecurityReport } from '../../src/modules/security/security-audit.service';
import { SecurityGuardianAgent, SECURITY_GUARDIAN_ID } from '../../src/modules/security/security-guardian.agent';
import { SecuritySchedulerService } from '../../src/modules/security/security-scheduler.service';
import { STANDARDS, TOTAL_WEIGHT } from '../../src/modules/security/standards';
import { RateLimitService } from '../../src/common/rate-limit.service';
import { MachineTokensService } from '../../src/modules/machine-tokens/machine-tokens.service';
import { InProcessAgentEventBus } from '../../src/modules/orchestrator/agent-event-bus';
import { ExpertRegistry } from '../../src/modules/orchestrator/expert-registry';
import type { StorageProvider } from '../../src/providers/storage/storage.provider';
import type { PythonWorkerService } from '../../src/modules/orchestrator/python-worker.service';

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
    delete: async (k) => void store.delete(k),
    list: async () => [...store.keys()],
    verifyConfig: async () => true,
    getMetadata: async () => null,
  };
}

function makeAudit(opts: {
  envVal?: Record<string, string>;
  storage?: StorageProvider;
  workers?: Partial<PythonWorkerService>;
}): { audit: SecurityAuditService; tokens: MachineTokensService; storage: StorageProvider } {
  const storage = opts.storage ?? memStorage();
  const tokens = new MachineTokensService(
    new ConfigService({ MACHINE_TOKEN_SECRET: 'guardian-test-secret' }),
    storage,
  );
  const workers = {
    probe: async () => ({ alive: true, detail: '{"pong":true}' }),
    ...(opts.workers ?? {}),
  } as unknown as PythonWorkerService;
  const audit = new SecurityAuditService(
    new ConfigService({ NODE_ENV: 'development', ...(opts.envVal ?? {}) }),
    new RateLimitService(),
    tokens,
    workers,
    storage,
    0,
  );
  return { audit, tokens, storage };
}

describe('P6-S3 standards catalog', () => {
  it('weights sum to exactly 10 — the score really is out of ten', () => {
    expect(Number(TOTAL_WEIGHT.toFixed(6))).toBe(10);
  });

  it('every check carries at least one real standard reference', () => {
    for (const def of STANDARDS) {
      expect(def.standardRefs.length).toBeGreaterThan(0);
      expect(def.standardRefs[0]).toMatch(/OWASP|ASVS|CWE|NIST|SPEC/);
    }
  });
});

describe('P6-S3 SecurityAuditService probes', () => {
  it('a healthy dev box scores high but secrets-hygiene is a WARN, not free 10', async () => {
    const { audit } = makeAudit({});
    const report = await audit.run();
    expect(report.results).toHaveLength(STANDARDS.length);
    expect(report.postureScore).toBeGreaterThanOrEqual(0);
    expect(report.postureScore).toBeLessThanOrEqual(10);
    const secretCheck = report.results.find((r) => r.checkId === 'secrets.env-hygiene');
    expect(secretCheck?.status).toBe('warn'); // placeholders in dev → warn honestly
    // HSTS is not applicable off-prod; excluded from denominator, not credited
    const hsts = report.results.find((r) => r.checkId === 'transport.hsts');
    expect(hsts?.status).toBe('not_applicable');
  });

  it('wildcard CORS is a sent-down FAIL', async () => {
    const { audit } = makeAudit({ envVal: { CORS_ORIGINS: '* , https://ok.example' } });
    const report = await audit.run();
    const cors = report.results.find((r) => r.checkId === 'cors.allowlist');
    expect(cors?.status).toBe('fail');
  });

  it('expired-but-live machine tokens are auto-revoked by the scan', async () => {
    const { audit, tokens } = makeAudit({});
    const issued = await tokens.issue({
      label: 'zombie', scopes: ['client:read'], createdBy: 'u1', expiresInDays: -1,
    });
    await audit.run();
    const after = (await tokens.list()).find((t) => t.tokenId === issued.record.tokenId);
    expect(after?.revokedAt).not.toBeNull();
  });

  it('limits Really throttle (the probe uses the same code path OTP uses)', async () => {
    const { audit } = makeAudit({});
    const report = await audit.run();
    expect(report.results.find((r) => r.checkId === 'auth.otp-throttle')?.status).toBe('pass');
    expect(report.results.find((r) => r.checkId === 'rate-limit.global')?.status).toBe('pass');
  });

  it('worker silence is a WARN with a remediation, never a silent pass', async () => {
    const { audit } = makeAudit({
      workers: { probe: async () => ({ alive: false, detail: 'queue unreachable' }) },
    });
    const report = await audit.run();
    const workers = report.results.find((r) => r.checkId === 'workers.liveness');
    expect(workers?.status).toBe('warn');
    expect(workers?.evidence).toContain('queue unreachable');
    expect(workers?.remediationFa).toBeTruthy();
  });
});

describe('P6-S3 reports persist + deltas + leader feed', () => {
  it('runAndPersist records history; a CORS fix shows up as improved delta', async () => {
    const storage = memStorage();
    // first run: wildcard CORS → fail
    const bad = makeAudit({
      envVal: { CORS_ORIGINS: '*' },
      storage,
    });
    await bad.audit.runAndPersist('agent');
    // second run: fixed config, same storage
    const good = makeAudit({ storage });
    const report = await good.audit.runAndPersist('manual');
    expect(report.deltas.improved).toContain('cors.allowlist');
    expect(report.reportId).toMatch(/^secr-/);
    const history = await good.audit.readHistory();
    expect(history.length).toBe(2);
  });

  it('guardian execute() runs the audit and reports TO THE LEADER via the bus', async () => {
    const { audit, storage } = makeAudit({});
    const bus = new InProcessAgentEventBus();
    const guardian = new SecurityGuardianAgent(audit as never, bus);
    // registers into the same fleet registry as legal experts
    const registry = new ExpertRegistry();
    registry.register(guardian);
    expect(registry.describeTree().flatMap((f) => f.agents)).toContain(SECURITY_GUARDIAN_ID);

    const events: string[] = [];
    bus.subscribe((ev) => events.push(`${ev.kind}:${ev.agentId}:${ev.detail ?? ''}`));
    const result = await guardian.execute({ taskId: 'g1', query: 'بازرسی امنیتی کامل' });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('نگهبان امنیت');
    expect(events.some((e) => e.startsWith(`security.scanned:${SECURITY_GUARDIAN_ID}`))).toBe(true);
    expect(events[0]).toMatch(/posture=\d+(\.\d)?\/10/);
    // leader detail carries counts + reportId, never evidence strings
    expect(events[0]).toContain('reportId=secr-');
    expect((await audit.readHistory()).length).toBe(1);
    expect(storage).toBeTruthy();
  });

  it('guardian routes security queries, declines legal ones', async () => {
    const { audit } = makeAudit({});
    const guardian = new SecurityGuardianAgent(audit as never, new InProcessAgentEventBus());
    const routed = await guardian.route({ query: 'وضعیت امنیت و تطابق استانداردها' });
    expect(routed?.skillId).toBe('security:standards-audit');
    expect(await guardian.route({ query: 'طلاق توافقی ازدواج' })).toBeNull();
  });

  it('scheduler arms a daily timer by default and reports its state honestly', () => {
    const { audit } = makeAudit({});
    const bus = new InProcessAgentEventBus();
    const sched = new SecuritySchedulerService(
      audit as never,
      bus,
      new ConfigService({ NODE_ENV: 'test' }),
    );
    sched.onModuleInit(); // NODE_ENV=test → disarmed
    expect(sched.state().armed).toBe(false);
    expect(sched.state().intervalMs).toBe(86_400_000);
    sched.onModuleDestroy();
  });

  it('#12-close: a scan with a FAILURE or a REGRESSION escalates to the critical channel', async () => {
    const bus = new InProcessAgentEventBus();
    const emitted: Array<{ kind: string }> = [];
    bus.subscribe((e) => emitted.push(e as { kind: string }));

    const fakeReport = (over: Partial<SecurityReport>): SecurityReport => ({
      reportId: 'r1', at: new Date().toISOString(), standardsVersion: 't',
      postureScore: 8, applicableChecks: 9, passed: 9, warned: 0, failed: 0,
      results: [], deltas: { improved: [], regressed: [] }, ...over,
    } as unknown as SecurityReport);
    const fakeAudit = { runAndPersist: async () => fakeReport({}) };
    const sched = new SecuritySchedulerService(fakeAudit as never, bus, new ConfigService({}));
    await sched.runNow('manual');
    expect(emitted.map((e) => e.kind)).toEqual(['security.scanned']); // heartbeats don't page anyone

    fakeAudit.runAndPersist = async () => fakeReport({ failed: 1 });
    await sched.runNow('manual');
    expect(emitted.map((e) => e.kind).filter((k) => k === 'security.regressed')).toHaveLength(1); // the fire signal

    fakeAudit.runAndPersist = async () =>
      fakeReport({ deltas: { improved: [], regressed: ['auth.otp-throttle'] } });
    await sched.runNow('manual');
    expect(emitted.map((e) => e.kind).filter((k) => k === 'security.regressed')).toHaveLength(2);
  });
});
