# ROADMAP — Agentic Legal Platform (فاز‌بای‌فاز، تسک‌بای‌تسک)

> Single source of truth for sequencing. `docs/SPEC.md` stays the truth for
> product rules; this file is the truth for execution order.
> Brain/memory: `scripts/agent_state.json`. Protocol: `docs/HANDOFF.md`.

Legend: `[ ]` pending · `[x]` done · task ids `P{phase}-T{n}` are stable forever.

---

## Phase 0 — Foundation & Memory ✅ (target: this session)

State engine, handoff protocol, agent DNA (interfaces), skeletons. Every later
phase depends on these compile-checked contracts.

- [x] **P0-T1** State engine: `scripts/agent_state.json` + `scripts/checkpoint.mjs`
- [x] **P0-T2** Handoff protocol: `AGENTS.md` (entry point) + `docs/HANDOFF.md`
- [x] **P0-T3** This roadmap + `docs/architecture_decisions.md`
- [x] **P0-T4** Core interfaces in `packages/shared/src/interfaces/`:
  `IAgent`, `ISkill`, `IExpertAgent`, `ICollectorAgent`, `KnowledgeGraph`,
  `AgentTask`, `AgentResult`
- [x] **P0-T5** `apps/agents/legal-expert-base` skeleton with `capabilities.ts` + tests
- [x] **P0-T6** Orchestrator skeleton (`apps/api/src/modules/orchestrator`) + tests
- [ ] **P0-T7** Workspace wiring, green build/typecheck/tests, checkpoint commit

## Phase 1 — The Expert Tree (تخصص)

Hierarchical, specialized agents in `apps/agents/{branch}`. Each owns a
`capabilities.ts` (its skills) and registers with the orchestrator.
All agents speak `IExpertAgent`; none call LLM SDKs directly — every AI call
goes through `providers/ai` adapters (SPEC §8), which Phase 1/4 keeps mock-first.

- [ ] **P1-T1** `apps/agents/civil-expert` (امور مدنی): skills = قراردادها،
  مسئولیت مدنی، املاک. Capabilities + unit tests.
- [ ] **P1-T2** `apps/agents/criminal-expert` (کیفری): آیین‌نامه دادرسی کیفری،
  مجازات‌ها. Capabilities + unit tests.
- [ ] **P1-T3** `apps/agents/family-expert` (خانواده): طلاق، حضانت، مهریه.
- [ ] **P1-T4** `apps/agents/registration-expert` (ثبتی): سند، شرکت‌ها.
- [ ] **P1-T5** Agent `lifecycle.ts`: queued → running → done | failed with
  retry policy; emitted domain events (`agent.task.completed` …) on Redis queue.
- [ ] **P1-T6** Orchestrator `expert-registry.ts`: static in-memory registry
  now, interface pinned so Phase 5 can swap to DB-backed without callers noticing.
- [ ] **P1-T7** Persian intent taxonomy in `packages/contracts` (shared enums:
  `IntentKind`, `LegalField`) — no enum duplication (SPEC §4).
- [ ] **P1-T8** E2E: a query per expert routes correctly through the tree.

## Phase 2 — Data Lifecycle (چرخه حیات داده)

Autonomous collectors → validators → updaters. Trust tiers per SPEC §9.
Law versioning = temporal (valid_from/valid_to), never overwrite history.

- [ ] **P2-T1** Migration: `ai/corpus` tables from SPEC §5
  (`knowledge_sources`, `ingestion_jobs`, `legal_documents`, `document_chunks`,
  `citation_links`, `retrieval_sessions`, `retrieval_results`) — pgvector-ready.
- [ ] **P2-T2** `ICollectorAgent` implementations: official-source scrapers
  (روزنامه رسمی، پایگاه قوانین) behind a per-source adapter interface; mock-first.
- [ ] **P2-T3** `ValidatorAgent`: checksum/provenance audit, marks
  `verified_at` (the "green tick") only when trust ≥ tier 1 passes checks.
- [ ] **P2-T4** `UpdaterAgent`/temporal logic: diff incoming law vs stored,
  version bump with `superseded_by`, effective-date aware.
- [ ] **P2-T5** Ingestion worker (Redis queue, `IngestionJobState` machine)
  with idempotent re-runs and partial_success accounting.
- [ ] **P2-T6** Diagnostics surfacing: sync failures visible in
  `/api/dashboard/diagnostics` with manual retry (SPEC §9).

## Phase 3 — The Orchestrator (هدایت‌گر)

Deterministic intent classification first; LLM only as tie-breaker (SPEC §9
"Layered AI"). Routes to shortest matching path in the expert tree.

- [ ] **P3-T1** `intent-classifier.ts`: weighted Persian/English keyword +
  structure scoring → `IntentKind` + `LegalField` + confidence.
- [ ] **P3-T2** Router: tree walk, deterministic rules → LLM schema-validated
  fallback (JSON only) via AIProvider; `habitual_offender` guard = never route
  legal advice to tier-3 sources.
- [ ] **P3-T3** Session context: Redis-backed short-term memory per user
  (with TTL), PRO added on Phase 5 auth pairing.
- [ ] **P3-T4** Budget gate: per-feature quota check before any LLM call;
  `budget_exhausted → deterministic-only mode`.
- [ ] **P3-T5** Dashboard endpoints: route, agents list, dry-run with trace.

## Phase 4 — RAG Pipeline (تولید سند با استناد)

pipelinespec §9 verbatim: ingest → normalize → chunk → embed → pgvector →
retrieve → rerank → draft WITH citations → **lawyer review (mandatory)**.

- [ ] **P4-T1** Retrieval module: vector search over `document_chunks`
  (cosine, dimension from provider metadata; never assume 1536).
- [ ] **P4-T2** Reranker: trust-tier boost + recency + jurisdiction filters.
- [ ] **P4-T3** Drafting: `DraftRequest` state machine enforcement,
  citation-required generation prompt, output = draft + provenance bundle.
- [ ] **P4-T4** Review console API: approve/reject/supersede, audit-logged.
- [ ] **P4-T5** Metering: `usage_records` per call; monthly budget alert.

## Phase 5 — Platform-Agnostic Surface (API یکپارچه)

Everything the agents can do, exposed contract-first so Web, Next APIs,
Telegram mini-app, تلفن و… consume it identically.

- [ ] **P5-T1** OpenAPI-complete `/api/dashboard/orchestrator/*` + `agents/*`.
- [ ] **P5-T2** Streaming (SSE) for draft generation progress.
- [ ] **P5-T3** Machine tokens for external front-ends (scoped, revocable).
- [ ] **P5-T4** Persian i18n keys for all agent-facing UI strings (web feature
  `features/agents/`).

## Phase 6 — Hardening (ده از ده)

- [ ] **P6-T1** Coverage gate ≥ target on new packages; provider-contract tests
  extended to orchestrator fixtures.
- [ ] **P6-T2** Chaos tests: AI provider down ⇒ graceful degradation, no crash
  (SPEC §2 failure domains).
- [ ] **P6-T3** Audit trail: every agent decision replayable.
- [ ] **P6-T4** Docs: operator runbook, per-agent README, ADR backlog closed.
