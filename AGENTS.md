# AGENTS.md

Guidance for AI coding agents and new contributors working in this repository. Human-oriented details are in [CONTRIBUTING.md](CONTRIBUTING.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Setup

```bash
npm ci                      # Node.js 22 required
npm run build:packages      # shared packages and agents must be built before the apps
```

Rebuild the packages after changing anything in `packages/*` or `apps/agents/*`; the apps import them from `dist/`.

## Checks

```bash
npm run typecheck
npm run lint                # type-aware promise rules for apps/api
npm test                    # all workspaces; run from the repository root
npm run test:py             # Python worker
npm run security:secrets
```

Run a single API test file with `cd apps/api && npx jest test/billing/client-controller`.

## Layout

```
apps/api            NestJS 11 API; migrations in src/database/migrations
apps/web            Office dashboard (Next.js 15, Persian i18n in src/i18n)
apps/client         Client portal (Next.js 15, basePath /portal)
apps/agents/*       Expert assistants; each has a capabilities.ts
apps/workers/py     Python text-processing worker (standard library only)
packages/domain     Enums and state machines (single source of truth)
packages/shared     Agent interfaces and the agent kit
packages/contracts  ERROR_CODES and httpStatusForCode
infra/              Dockerfiles and nginx configuration
scripts/            install, update, backup, restore, diagnostics, logs
```

## Rules

- **Providers:** SDK and HTTP calls to external services only in `apps/api/src/providers/*`. In production a provider set to `mock` is replaced by an adapter that reports "not configured"; never return simulated success.
- **Errors:** throw a code from `ERROR_CODES` with a formal Persian message, for example `new ConflictException({ code, message })`. New codes need a known prefix and a status in `httpStatusForCode`.
- **Enums:** shared terms live in `packages/domain`; do not duplicate them.
- **Database:** never run pool queries while holding a client from `pool.connect()`; release the client first. Add migrations as the next three-digit number; never edit released migrations.
- **Promises:** await every promise or attach a `.catch`. `npm run lint` fails otherwise.
- **Tests:** logic changes ship with tests. Use `queue.settled()` instead of sleeps. Do not use dynamic `import()` in `src` (it breaks Jest). New constructor dependencies go last and are optional, so existing tests keep compiling.
- **Texts:** user-facing Persian is formal. When changing an API message, search `apps/api/test` for the old text. Keep the Persian and English i18n keys in sync.
- **Legal content:** cite exact articles of laws in force; do not hard-code fines or prices.
- **Licence:** keep `LICENSE`, `NOTICE` and the attribution in the UI footer and About screen unchanged (AGPL section 7 terms).

## Running locally

`docker compose up -d --build` starts the full stack on `http://localhost:8080` (dashboard), `/portal/` (client portal) and `/api/` (API). With `NODE_ENV=development` and `SMS_PROVIDER=mock`, the OTP request response includes a `devCode` field so you can sign in without SMS.
