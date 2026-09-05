#!/usr/bin/env node
/**
 * Repo secret scan (P6-S2) — deterministic regex sweep over git-tracked
 * files. Zero dependencies; run via `npm run security:secrets` and pinned by
 * apps/api/test/security/repo-secrets.spec.ts so a leaked key can never be
 * merged quietly.
 *
 * Semantics:
 * - scans CODE files only (ts/js/py/json/yml/yaml/env-ish);
 * - skips tests/fixtures/docs/i18n (they legitimately carry sample literals);
 * - every finding must either be real (fix it!) or added to
 *   tools/security/secret-scan.allowlist.json with a reason.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|json|ya?ml|env|sh)$/;

const SKIP_PATHS = [
  /(^|\/)test(s)?\//,          // fixtures carry intentional literals
  /\.(spec|test)\./,
  /(^|\/)(docs|README|AGENTS)/,
  /\.env\.example$/,
  /(^|\/)i18n\//,              // translations are UI strings, not secrets
  /packages\/contracts\/dist\//,
  /secret-scan/,               // our own rule strings are not credentials
];

const RULES = [
  { id: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/, severity: 'critical' },
  { id: 'private-key-block', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, severity: 'critical' },
  { id: 'gh-token', re: /gh[pousr]_[A-Za-z0-9]{36,}/, severity: 'critical' },
  { id: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/, severity: 'high' },
  {
    id: 'hardcoded-credential-shape',
    re: /(?:password|passwd|api[_-]?key|secret[_-]?key)\s*[:=]\s*['"](?!your_|change_me|dev-secret|unit-secret|guardian-test|test-|placeholder|\$\{|\{\{)[A-Za-z0-9+/=_-]{16,}['"]/i,
    severity: 'high',
  },
  { id: 'bearer-literal', re: /Bearer\s+[A-Za-z0-9\-_.+/=]{32,}/, severity: 'high' },
];

function loadAllowlist() {
  const p = join(HERE, 'secret-scan.allowlist.json');
  if (!existsSync(p)) return { skipFiles: [], reason: 'no allowlist file' };
  return JSON.parse(readFileSync(p, 'utf8'));
}

export const SCAN_RULES = RULES;

/** Test hook: apply all rules to an in-memory line set (self-test + reuse). */
export function scanText(path, content) {
  const out = [];
  content.split('\n').forEach((line, idx) => {
    for (const rule of RULES) if (rule.re.test(line)) out.push({ ruleId: rule.id, severity: rule.severity, path, line: idx + 1 });
  });
  return out;
}

export function scan(root = ROOT) {
  const allowlist = loadAllowlist();
  const skipped = new Set(allowlist.skipFiles ?? []);
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => CODE_EXT.test(f))
    .filter((f) => !SKIP_PATHS.some((rx) => rx.test(f)))
    .filter((f) => !skipped.has(f));

  const findings = [];
  for (const file of files) {
    let content;
    try {
      content = readFileSync(join(root, file), 'utf8');
    } catch {
      continue; // deleted-but-tracked mid-rebase; next run will converge
    }
    content.split('\n').forEach((line, idx) => {
      for (const rule of RULES) {
        if (rule.re.test(line)) {
          findings.push({ ruleId: rule.id, severity: rule.severity, path: file, line: idx + 1 });
        }
      }
    });
  }
  return { scannedFiles: files.length, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    // Guarding the guard: synthetic positive + negative + placeholder shapes.
    const pos = scanText('synthetic.ts', 'const k = "AKIAIOSFODNN7EXAMPLE";');
    const neg = scanText('clean.ts', 'const x = 1; // nothing here');
    const placeholders = scanText('env.ts', "secret: 'your_jwt_access_secret_here'");
    const ok = pos.some((f) => f.ruleId === 'aws-access-key') && neg.length === 0 && placeholders.length === 0;
    console.log(JSON.stringify({ selfTestOk: ok, pos: pos.length, neg: neg.length, placeholders: placeholders.length }));
    process.exit(ok ? 0 : 1);
  }
  const { scannedFiles, findings } = scan();
  console.log(`secret-scan: ${scannedFiles} files, ${findings.length} finding(s)`);
  for (const f of findings) {
    console.log(`  [${f.severity}] ${f.ruleId} @ ${f.path}:${f.line}`);
  }
  process.exit(findings.length === 0 ? 0 : 1);
}
