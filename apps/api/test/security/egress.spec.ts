import {
  assertPublicEgressAllowed,
  assertLanUrlAllowed,
  EgressDeniedError,
} from '../../src/security/egress';

/**
 * FIELD REVIEW 2026-09-05 #3 — SSRF border. These cases are written the way
 * an attacker writes them: metadata IPs, localhost fan-out, DNS names that
 * LOOK fine, env-less production. Every one must die at the gate.
 */
describe('egress guard — public (cloud brain) lane', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it('denies loopback, RFC1918, link-local and cloud-metadata hosts', async () => {
    process.env.NODE_ENV = 'production';
    for (const bad of [
      'https://127.0.0.1:11434', 'https://10.1.2.3', 'https://172.16.0.9',
      'https://192.168.1.10', 'https://169.254.169.254/latest/meta-data',
      'https://localhost:3000', 'https://printer.office.local',
      'https://metadata.google.internal/', 'https://0.0.0.0',
      'https://[::1]/v1/models', 'https://[fe80::1%25eth0]/',
    ]) {
      await expect(assertPublicEgressAllowed(bad)).rejects.toBeInstanceOf(EgressDeniedError);
    }
  });

  it('denies http in production, allows it in development (local cloud-lab rigs)', async () => {
    process.env.NODE_ENV = 'production';
    await expect(assertPublicEgressAllowed('http://api.openai.com')).rejects.toBeInstanceOf(EgressDeniedError);
    process.env.NODE_ENV = 'development';
    await expect(assertPublicEgressAllowed('http://api.openai.com')).resolves.toBeUndefined();
  });

  it('denies urls with embedded credentials', async () => {
    await expect(assertPublicEgressAllowed('https://user:pass@example.com')).rejects.toBeInstanceOf(EgressDeniedError);
  });

  it('enforces AI_EGRESS_ALLOW when configured', async () => {
    process.env.NODE_ENV = 'development';
    process.env.AI_EGRESS_ALLOW = 'openrouter.ai, api.anthropic.com';
    await expect(assertPublicEgressAllowed('https://evil-vendor.example.com'))
      .rejects.toBeInstanceOf(EgressDeniedError);
    await expect(assertPublicEgressAllowed('https://api.anthropic.com')).resolves.toBeUndefined();
  });

  it('rejects garbage input instead of cleaning it', async () => {
    await expect(assertPublicEgressAllowed('not a url')).rejects.toBeInstanceOf(EgressDeniedError);
    await expect(assertPublicEgressAllowed('')).rejects.toBeInstanceOf(EgressDeniedError);
  });
});

describe('egress guard — LAN (local brain) lane', () => {
  it('allows LAN hosts — private IPs are the point of the local brain', () => {
    expect(() => assertLanUrlAllowed('http://192.168.1.50:11434')).not.toThrow();
    expect(() => assertLanUrlAllowed('https://ollama.internal')).not.toThrow();
  });

  it('still refuses exotic protocols and credentials', () => {
    expect(() => assertLanUrlAllowed('file:///etc/passwd')).toThrow(EgressDeniedError);
    expect(() => assertLanUrlAllowed('gopher://x')).toThrow(EgressDeniedError);
    expect(() => assertLanUrlAllowed('http://user:pw@host')).toThrow(EgressDeniedError);
  });
});
