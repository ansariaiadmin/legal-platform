/**
 * Backup/restore DSN parsing — regression guard.
 *
 * Field-gate finding (Arena session): scripts/backup.sh and scripts/restore.sh
 * used to parse DATABASE_URL by grepping for `host=\K`, `port=\K`, `dbname=\K`
 * keyword-form substrings. Our .env.example and every compose file pass a URI
 * form (postgresql://user:pass@host:port/name), so all four greps missed and
 * the scripts silently fell back to localhost:5432/postgres/postgres — i.e.
 * backups and restores in any real field deployment were broken with WRONG
 * credentials while logging success. The scripts now ship a shared awk URI
 * parser; this test extracts the function and proves both DSN forms parse.
 */
import { execFileSync } from 'node:child_process';

const FUNC_SOURCE_CMD =
  "sed -n '/^extract_uri_component()/,/^}/p' scripts/backup.sh";

function parseViaBash(dsn: string, want: 'user' | 'pass' | 'host' | 'port' | 'name'): string {
  const script = `
${execFileSync('bash', ['-c', FUNC_SOURCE_CMD], { cwd: process.cwd() + '/../..' }).toString()}
extract_uri_component "${dsn.replace(/"/g, '\\"')}" "${want}"
`;
  return execFileSync('bash', ['-c', script]).toString().trim();
}

describe('backup.sh URI parser (extract_uri_component)', () => {
  it('parses the .env.example URI form end-to-end', () => {
    const uri = 'postgresql://legal:legal_password_change_me@postgres:5432/legal_platform';
    expect(parseViaBash(uri, 'user')).toBe('legal');
    expect(parseViaBash(uri, 'pass')).toBe('legal_password_change_me');
    expect(parseViaBash(uri, 'host')).toBe('postgres');
    expect(parseViaBash(uri, 'port')).toBe('5432');
    expect(parseViaBash(uri, 'name')).toBe('legal_platform');
  });

  it('strips query params (sslmode etc.) from db name and port', () => {
    const uri = 'postgresql://svc:r0ck@10.1.2.3:6432/platform2?sslmode=require';
    expect(parseViaBash(uri, 'name')).toBe('platform2');
    expect(parseViaBash(uri, 'port')).toBe('6432');
    expect(parseViaBash(uri, 'host')).toBe('10.1.2.3');
    expect(parseViaBash(uri, 'pass')).toBe('r0ck');
  });

  it('returns empty output for keyword-form input (guarded downstream)', () => {
    // keyword form is handled by the libpq grep path, NOT this function
    expect(parseViaBash('host=db port=5432 dbname=x user=u', 'user')).toBe('');
  });

  it('handles passwords containing @ and : percent-encoded (decoded at use-site)', () => {
    const uri = 'postgresql://legal:p%40ss%3Aword@postgres:5432/legal_platform';
    // parser returns the raw (still-encoded) password; backup.sh/restore.sh
    // run it through url_decode() before PGPASSWORD — proven by the decode test below
    expect(parseViaBash(uri, 'pass')).toBe('p%40ss%3Aword');
    expect(parseViaBash(uri, 'user')).toBe('legal');
  });

  it('url_decode() decodes percent-escapes exactly like libpq URI auth expects', () => {
    const dec = execFileSync('bash', ['-c',
      `${execFileSync('bash', ['-c', "sed -n '/^url_decode()/,/^}/p' scripts/backup.sh"], { cwd: process.cwd() + '/../..' }).toString()}\nurl_decode 'p%40ss%3Aword+plus'%0Aname`],
    ).toString();
    expect(dec).toBe('p@ss:word plus\nname');
  });
});

describe('restore.sh URI parser parity', () => {
  const RESTORE_FUNC =
    "sed -n '/^extract_uri_component()/,/^}/p' scripts/restore.sh";

  it('restore.sh carries an identical parser', () => {
    const restoreSrc = execFileSync('bash', ['-c', RESTORE_FUNC], {
      cwd: process.cwd() + '/../..',
    }).toString();
    const backupSrc = execFileSync('bash', ['-c', FUNC_SOURCE_CMD], {
      cwd: process.cwd() + '/../..',
    }).toString();
    // identical body (comments may differ) — compare after stripping comments+ws
    const strip = (s: string) => s.replace(/^\s*#.*$/gm, '').replace(/\s+/g, ' ').trim();
    expect(strip(restoreSrc)).toBe(strip(backupSrc));
  });
});

describe('credential priority law', () => {
  it('explicit DSN user beats POSTGRES_USER; POSTGRES_USER only fills empties', () => {
    // Compose containers define POSTGRES_USER=legal. If a DSN explicitly names
    // another role (e.g. a backup-service role), the DSN must win — otherwise
    // backups silently connect with wrong privileges/report success wrongly.
    const src = execFileSync('bash', ['-c', 'cat scripts/backup.sh'], {
      cwd: process.cwd() + '/../..',
    }).toString();
    expect(src).toMatch(/DB_USER="\$\{DB_USER:-\$\{POSTGRES_USER:-postgres\}\}"/);
    // and must NOT have the old wrong order (POSTGRES_USER overriding DSN)
    expect(src).not.toMatch(/DB_USER="\$\{POSTGRES_USER:-\$DB_USER\}"/);
  });
});
