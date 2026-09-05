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

## Phase 1 — The Expert Tree + Governance Backbone (تخصص + حکمرانی)

Hierarchical, specialized agents in `apps/agents/{branch}`. Each owns a
`capabilities.ts` (its skills) and registers with the orchestrator.
All agents speak `IExpertAgent`; none call LLM SDKs directly — every AI call
goes through `providers/ai` adapters (SPEC §8), which Phase 1/4 keeps mock-first.

- [x] **P1-T1** `apps/agents/civil-expert` (امور مدنی): contracts, property,
  tort, inheritance skills + persona + tests.
- [x] **P1-T2** `apps/agents/criminal-expert` (کیفری): defense, procedure,
  sentencing, crimes + persona + tests.
- [x] **P1-T3** `apps/agents/family-expert`: divorce, custody, dowry, support
  + persona + tests.
- [x] **P1-T4** `apps/agents/registration-expert`: deeds, companies, trademark,
  vital + persona + tests.
- [x] **P1-T12** `packages/shared/agent-kit.ts` — createExpertAgent is the
  society's genome (ADR-007); per-agent deltas = capabilities + persona only.
- [x] **P1-T13** `GET /dashboard/orchestrator/fleet` — society registry cards
  (persona, skills, health, live grant counts).
- [ ] **P1-T5** Agent `lifecycle.ts`: queued → running → done | failed with
  retry policy; emitted domain events (`agent.task.completed` …) on Redis queue.
- [ ] **P1-T6** Orchestrator `expert-registry.ts`: static in-memory registry
  now, interface pinned so Phase 5 can swap to DB-backed without callers noticing.
- [x] **P1-T7** Domain taxonomy in `packages/domain` (single home):
  `LegalField`, `IntentKind`, `AgentTier` — no enum duplication (SPEC §4).
- [x] **P1-T8** Fleet-routing suite: a Persian query per branch lands on the
  right expert + right skill; per-field grants proven to be non-transferable.
- [x] **P1-T9** Governance backbone (ADR-005): `AgentGrant` capability grants,
  dashboard issue/revoke/disable endpoints, `AI_AGENT_NOT_AUTHORIZED` gate.
- [x] **P1-T10** Hybrid inference router (ADR-004): local/cloud with per-task
  privilege pinning, budget demotion, tier defaults — all tested.
- [x] **P1-T11** Live ops stream (ADR-006): typed `AgentEvent`s, ring buffer +
  SSE endpoints, dashboard-ready shapes.

## Phase 1b — Voice & Fleet Personalities

- [x] **P1b-T1** LeaderVoiceService + mock VoiceEngine (honest `mocked` flag,
  never fakes audio bytes). Open-session / hear / speak endpoints.
- [ ] **P1b-T2** Real STT/TTS engines behind the VoiceEngine port (Whisper
  local box, admin-selectable per tier). Mock stays test-only.
- [ ] **P1b-T3** Persian corporate-tone prompts per agent role ("همکار متخصص"
  tone configs per agent — civil speaks contracts, criminal speaks procedure).

## Phase 1c — Self-evaluation & Evolution (خودتحولی جامعه)

- [x] **P1c-T1** `metrics-aggregator.service.ts` — live per-agent stats
  (success rate, latency, route scores, local/cloud, denials) off the event bus.
- [x] **P1c-T2** `evaluator.service.ts` — the Evaluator: deterministic rule
  engine under the Leader producing ranked Persian memos (ADR-008) with
  evidence + confidence. Read-only by construction.
- [x] **P1c-T3** `evolution.service.ts` — `POST /spawn` & `DELETE /spawn/:id`;
  validated runtime births through createExpertAgent with zero default grants
  and `-spawned` marker; core fleet cannot be retired (ADR-009).
- [x] **P1c-T4** Endpoints: `GET /dashboard/orchestrator/insights` (metrics +
  suggestions together). All evolution mutations audit-logged.
- [x] **P1c-T5** `apps/workers/py` — stdlib-only Python sidecar (persian_tools,
  minimal RESP2 client, BLPOP worker loop) + 19 unittests + Dockerfile +
  compose service `workers-py` (ADR-010).
- [ ] **P1c-T6** Evaluator gets an LLM-assisted second pass (Persona: board
  advisor) — gated behind tier≥counsel and LOW-confidence re-checks only.

## Phase 2 — Data Lifecycle (چرخه حیات داده)

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
