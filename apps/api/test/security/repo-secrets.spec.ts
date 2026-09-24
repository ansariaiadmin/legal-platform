import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const SCANNER = resolve(__dirname, '../../../../tools/security/secret-scan.mjs');

/**
 * P6-S2: the repo must never contain a live credential. A jest gate, run as
 * a subprocess over the REAL scanner, so a leaked key fails the build on
 * every machine — including engineers' laptops before push.
 */
describe('P6-S2 repo secret scan', () => {
  it('zero hardcoded secrets across all tracked code files', () => {
    try {
      const out = execFileSync('node', [SCANNER], { encoding: 'utf8' });
      expect(out).toContain('0 finding(s)');
    } catch (err) {
      const stdout = (err as { stdout?: string }).stdout ?? String(err);
      throw new Error(`secret scan FAILED:\n${stdout}`);
    }
  });

  it('the scanner catches a planted key (guarding the guard)', () => {
    const out = execFileSync('node', [SCANNER, '--self-test'], { encoding: 'utf8' });
    const parsed = JSON.parse(out.trim()) as { selfTestOk: boolean };
    expect(parsed.selfTestOk).toBe(true);
  });
});
