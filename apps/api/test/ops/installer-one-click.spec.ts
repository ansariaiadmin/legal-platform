/**
 * One-click installer contract — guards the promise of setup.sh + install.sh.
 *
 * The whole point of `./setup.sh` is "click once, everything clean". These
 * tests statically pin the load-bearing invariants that regressions love to
 * silently break:
 *   1. Every secret placeholder in .env.example is actually ROTATED by
 *      install.sh (a forgotten sed = a production box shipping a known key).
 *   2. POSTGRES_PASSWORD and the password inside DATABASE_URL are generated
 *      from ONE source value — otherwise the API can't reach its own DB.
 *   3. docker-compose.yml must not hard-code the shipped dev credential.
 *   4. setup.sh → install.sh delegation + --check mode stays intact.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('one-click installer contract', () => {
  it('root setup.sh exists, is executable, and delegates to install.sh', () => {
    const p = path.join(ROOT, 'setup.sh');
    expect(fs.existsSync(p)).toBe(true);
    const stat = fs.statSync(p);
    // eslint-disable-next-line no-bitwise
    expect(stat.mode & 0o111).toBeGreaterThan(0);
    expect(read('setup.sh')).toContain('scripts/install.sh');
    expect(read('setup.sh')).toContain('--check');
  });

  it('every *.sh passes bash -n (syntax proof in test, not only at run time)', () => {
    const out = execFileSync('bash', ['-c',
      'cd ../.. && for f in setup.sh scripts/*.sh; do bash -n "$f" || { echo "SYNTAX FAIL: $f"; exit 1; }; done; echo ALL-OK'],
      { encoding: 'utf-8' },
    );
    expect(out.trim()).toBe('ALL-OK');
  });

  it('install.sh rotates ALL .env.example secrets that ship as placeholders', () => {
    const install = read('scripts/install.sh');
    const envExample = read('.env.example');
    // Placeholder-looking assignments: KEY=..._here or KEY= legal defaults
    const placeholders = envExample
      .split('\n')
      .filter((l) => /^[A-Z_]+=(your_|.*change_me)/.test(l))
      .map((l) => l.split('=')[0]);
    expect(placeholders.length).toBeGreaterThanOrEqual(4);
    for (const key of placeholders) {
      expect({
        key,
        rotated: new RegExp(`sed -i "s[/|]\\^${key}=`).test(install),
      }).toEqual({ key, rotated: true });
    }
  });

  it('POSTGRES_PASSWORD and DATABASE_URL share one generated value (sync law)', () => {
    const install = read('scripts/install.sh');
    // one variable ($PG_PASS) feeds BOTH the POSTGRES_PASSWORD line and the
    // password slot of the DATABASE_URL line
    expect(install).toMatch(/PG_PASS=\$\(generate_secret\)/);
    expect(install).toMatch(/sed -i "s\/\^POSTGRES_PASSWORD=\.\*\/POSTGRES_PASSWORD=\$PG_PASS\/"/);
    expect(install).toMatch(/DATABASE_URL=postgresql:\/\/legal:\$PG_PASS@/);
  });

  it('docker-compose.yml has no hard-coded legal_password_change_me anymore', () => {
    const compose = read('docker-compose.yml');
    expect(compose).not.toMatch(/POSTGRES_PASSWORD=legal_password_change_me(\s|$)/m);
    expect(compose).toMatch(/POSTGRES_PASSWORD=\$\{POSTGRES_PASSWORD:-legal_password_change_me\}/);
  });

  it('OTP_HASH_PEPPER rotation never overwrites an existing value (OTP continuity)', () => {
    const install = read('scripts/install.sh');
    expect(install).toMatch(/grep -qE '\^OTP_HASH_PEPPER=\$'/);
  });

  it('docs/RUNBOOK.md exists and covers the golden path', () => {
    const rb = read('docs/RUNBOOK.md');
    for (const step of ['sudo ./setup.sh', 'setup.sh --check', 'backup.sh', 'restore.sh --confirm', 'ویزارد', '/api/health']) {
      expect(rb).toContain(step);
    }
  });

  it('backup.sh prunes old backups (retention, default 30d) and sibling manifests too', () => {
    const bk = read('scripts/backup.sh');
    expect(bk).toContain('BACKUP_RETAIN_DAYS');
    expect(bk).toContain('manifest-${ts}.json'); // sibling manifest pruned too
  });

  it('diagnostics.sh never hardcodes -U postgres (env-aware like backup.sh)', () => {
    const dg = read('scripts/diagnostics.sh');
    expect(dg).not.toMatch(/pg_isready -U postgres/);
    expect(dg).toContain('POSTGRES_USER');
    // stale-backup alarm
    expect(dg).toContain('AGE_DAYS');
  });
});
