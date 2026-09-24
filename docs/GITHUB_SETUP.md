# GitHub Repository Setup

What GitHub-side automation this repository uses, and the one setting that has
to be applied by a repository admin.

## Configured in-repository (already active)

| File | What it does |
|---|---|
| `.github/workflows/ci.yml` | `quality` (typecheck + unit tests + both builds), `migrations` (real `pgvector/pgvector:pg16`, up → down → up, schema assertions), `integration` (real PostgreSQL + Redis, full auth flow), `docker` (builds both images and boots the API container) |
| `.github/workflows/codeql.yml` | CodeQL `security-and-quality` for JavaScript/TypeScript and for Actions, on push, PR and weekly |
| `.github/dependabot.yml` | Weekly npm / GitHub Actions / Docker updates, grouped so the Nest, TypeScript, Jest and Next families move together |
| `.github/pull_request_template.md` | Mirrors the Output Contract in SPEC section 12, including the validation checklist |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | Requires reproduction steps and exact command output, not a description |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | Forces the SPEC module and tier, plus explicit out-of-scope |
| `.github/ISSUE_TEMPLATE/config.yml` | Disables blank issues and routes security reports to private advisories |

## Required from a repository admin: branch protection

The automation account used to set this repository up does not have
administration rights, so it received `403 Resource not accessible by
integration` when calling the branch protection API. Run this once as an admin:

```bash
gh api -X PUT repos/ansariaiadmin/legal-platform/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Typecheck & unit tests",
      "Migrations (up / down / up)",
      "Integration (real PostgreSQL + Redis)",
      "Docker images build",
      "Analyze (javascript-typescript)",
      "Analyze (actions)"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

`strict: true` means a branch must be re-tested after `main` moves, so a green
check can never go stale.

Verify afterwards:

```bash
gh api repos/ansariaiadmin/legal-platform/branches/main/protection --jq '.required_status_checks.contexts'
```

## Why these four CI jobs

The repository previously shipped with a single job that ran `npm test`, and
that job was red: the migration spec asserted `export const up:` while every
migration used `export const up =`. A failing check that nobody is required to
wait for is worse than no check, because it teaches contributors to ignore red.

Each job now exists to catch a class of defect that actually occurred here:

- **quality** - the API could not even start (`Nest can't resolve dependencies
  of the AuthService ... argument Object at index [3]`), which only a full
  dependency-graph build reveals. `test/app/bootstrap.spec.ts` locks that down.
- **migrations** - `audit_logs.id`, `otp_challenges.id` and
  `role_assignments.id` had no default while the code inserted without an id.
  Only a real PostgreSQL catches that, and `AuditService` swallowed the error.
- **integration** - the JWT payload carried `sub` while controllers read
  `user.id`, so `/api/auth/me` always returned `AUTH_USER_NOT_FOUND`, and
  logout did not invalidate the access token. Both are asserted end to end.
- **docker** - `infra/docker/web.Dockerfile` copied `apps/web/public`, which did
  not exist, so the image could never build.

## Adding a new required check

1. Add the job to `.github/workflows/ci.yml` and give it a stable `name:`.
2. Merge it to `main` once so the check has reported at least once.
3. Add that exact name to `required_status_checks.contexts` with the command
   above - a name that has never reported cannot be required.
