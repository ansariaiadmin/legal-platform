## Implemented
<!-- What this PR does. Reference the SPEC section it satisfies. -->

## Files Created/Changed
<!-- Grouped by area: apps/api, apps/web, packages, infra, scripts, docs -->

## Commands To Run
```bash
npm ci
npm run build:packages
npm run typecheck --workspaces --if-present
npm test
# with a PostgreSQL available:
npm run migrate:up -w @legal-platform/api
npm run test:e2e -w @legal-platform/api
```

## Environment Variables Needed
<!-- New or changed variables. Keep .env.example in sync. -->

| Variable | Required | Default | Purpose |
|---|---|---|---|
| | | | |

## Tests Added
<!-- Name the suites and what behaviour they lock down. "No tests" needs a reason. -->

## Validation Before Marking Done
<!-- SPEC section 12. Tick only what you actually ran. -->
- [ ] `npm run typecheck --workspaces --if-present` passes
- [ ] `npm test` passes
- [ ] Migrations are deterministic (`npm run test:migrations -w @legal-platform/api`: up → down → up)
- [ ] `docker compose up --build` boots and `/api/health` reports `ok`
- [ ] New environment variables are documented in `.env.example`
- [ ] No secrets committed; no provider SDK called outside `apps/api/src/providers`
- [ ] No fake auth, fake payment success, fake encryption, or fake backup/ingestion success

## Known Limitations
<!-- What this PR deliberately does not do yet. -->

## Next Safe Step
<!-- The smallest useful change that can follow this one. -->
