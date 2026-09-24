# Changelog — legal-platform

## [1.0.0] - 2026-09-24

### Added
- 67 test suites, 476 tests passed, 0 failed (previously 2 pre-existing failures fixed)
- Orchestrator: deterministic-first routing, hybrid inference router, intent classifier, fleet routing, config hub, evolution, metrics + evaluator
- Legal experts: civil, criminal, family, base with grounding, corpus ingestion, collector worker, budget hard-stop
- Security: JWT + refresh, roles guard, rate-limit, egress, stream ticket, phone normalization
- Ops: backup-restore parsers (URI + keyword form), installer one-click, docker prod, local storage, diagnostics, migrations
- Billing: pg-wallet, wallet topup contract, payment provider contracts
- Providers: tenant-scoped storage, factory, contracts (ai, payment, sms, telephony, push)
- Frontend: Next.js dashboard, wizard, governance + voice
- CI: lint + typecheck + jest + build + docker
- Docs: README badge+mermaid+quickstart+sample output, ROADMAP Done vs v2, AGENTS, HANDOFF

### Fixed
- backup-restore-parsers: whitespace escaping fixed (credential priority law, url_decode)
- installer-one-click: .env.example path fixed at root, secret rotation, POSTGRES_PASSWORD + DATABASE_URL sync law, docker-compose no hard-coded password
- jest open handles: fixed async ops not stopped, all suites pass without --detectOpenHandles warning
- e2e orchestrator config: config-hub + intent classifier + fleet routing

### Security
- Secret scan 0 real (1 intentional test token sk-XyZ... in config-intent.spec.ts masked)
- .env.example complete per REPORT-7-FINAL: DATABASE_URL, REDIS_URL, JWT_SECRET, LOCAL_LLM_URL, CLOUD_LLM_KEY optional, NODE_ENV
- No private key, RLS + encryption

## [0.9.0] - 2026-09-07
- Previous release with 474 passed, 2 failed (backup-restore-parsers whitespace, installer .env.example)
