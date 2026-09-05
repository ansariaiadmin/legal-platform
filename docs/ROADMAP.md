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

## Phase 1d — Model Matrix & Leader Lending (ماتریس مدل)

- [x] **P1d-T1** `model-assignment.service.ts` — per-agent (target, model) pins.
- [x] **P1d-T2** Router learns `agentId`: secrecy law > manual pin > Leader
  lends its own API (`assignmentSource: leader_fallback`, concrete model id,
  reason string) — provenance always emitted to the live stream.
- [x] **P1d-T3** Endpoints `GET/POST/DELETE /dashboard/orchestrator/models…`
  (owner writes; everyone reads the matrix). Unassign reassigns to lending.
- [x] **P1d-T4** `pylegal/model_client.py` — stdlib OpenAI-compatible client;
  env-resolved config, retryability flags, key never in URL. `ask_model` worker
  tool added (honest `no_model_configured` when unconfigured — no fake answer).
- [x] **P1d-T5** `providers/queue/redis-resp.client.ts` (TS) + py
  `resp_client.py` — one codec, two languages (ADR-012); bridge tests against
  a socket-level fake Redis pass.

## Phase 1e — Leader's File Sandbox (جعبه ابزار فایلی لیدر)

The office life is files. Lawyers upload into StorageProvider, the Leader reads
them FIRST, answers FROM their text, and suggests a content-aware PLACEMENT —
the corpus becomes a living library, not a black box.

- [x] **P1e-T1** `pylegal/file_extract.py` — pure-stdlib: magic dispatch
  (`%PDF` / `PK\x03\x04` + name→docx / corrupted→needs_manual_review),
  PDF regex `Tj/TJ` + FlateDecode, docx via zipfile+ElementTree,
  scanned PDF ⇒ `needs_ocr: true` (never hallucinated), else UTF-8/Win-1256.
- [x] **P1e-T2** Files registry (`FileIntelligenceService`) + upload
  endpoint `POST /dashboard/orchestrator/files` (multer memory, 10 MB cap);
  sha256 FIRST, StorageProvider put, SSE event `file.uploaded`.
- [x] **P1e-T3** `PlacementService` — attachment content scored with the
  SAME `vocabularyScore` agents route by; strong overlap ⇒ concrete
  `skillId`+collection, weak ⇒ `needs-review`, never a fake pick.
- [x] **P1e-T4** `LeaderConversationService` — continuous chat +
  voice (hear → chat → speak) riding the governed dispatch path; owner-scoped
  conversations; no grant bypass; turns trimmed at 100; SSE `conversation.turn`.
- [x] **P1e-T5** Inline TS fallback (`completed_inline`) on text when the
  queue is down (SPEC §2) — binaries honestly report only a digest, no
  hallucinated parse.
- [x] **P1e-T6** Tests: 6 new Jest file-intelligence/conversation specs +
  12 py tests incl. real-ZIP docx fixture and a crafted FlateDecode PDF;
  ADR-013 pinned. **API 172 jest — Python 36 unittest — build clean.**

## Phase 1f — Self-Service Dashboard & The Live Kitchen (پلتفرمِ خودپیکربند)

The owner configures EVERYTHING with tabs or just by TALKING to the Leader —
«به مدل محلی وصل شو آدرس http://gpu-box:8080» → پیشنهاد → «بله» → وصل شد.

- [x] **P1f-T1** `ConfigHubService` + `ConfigHubController`: GET view
  (secrets masked `••••last4`, env/runtime source per brain), POST brain
  (persisted via StorageProvider port `runtime/brain-config.json`),
  POST brain/test (honest probe), POST preset. Router consults overrides
  first — secrecy law still untouchable (no UI switch for it, ever).
- [x] **P1f-T2** Conversational configuration: deterministic Persian
  intent parsing → proposal → confirm (chat «بله» OR button
  `/leader/config-proposals/:id/accept`) → applied + audited.
  Owner-scoped; intruder proposals are refused.
- [x] **P1f-T3** `DEV_DASHBOARD_TOKEN` sandbox door — dev-only bypass with
  fixed `dev-owner` identity; production short-circuits before comparing.
- [x] **P1f-T4** Next.js RTL Persian dashboard: six tabs (خانه، اتصال مغز،
  ناوگان، چت با لیدر، فایل‌ها، آشپزخانه زنده), login by OTP + dev token,
  same-origin `/api` rewrite so preview hosts never touch localhost.
- [x] **P1f-T5** 🍳 THE live kitchen: SSE → agent orbs light while cooking,
  golden/violet/green packets FLY leader→expert→back, inference decisions
  carry model badges, event ticker à la Telegram. `node:http` raw proxy
  because Next's patched fetch buffers event streams to death (documented).
- [x] **P1f-T6** +15 jest (187 total), ADR-014.1.0, all suites + builds green.

## Phase 2a — Public Commerce & Telecoms Queue (پول + صف + PWA)

The public CLIENT lives on its own Next server (apps/client, port 3100) —
installable PWA, OTP login, wallet, shop, queue, notifications. The LAWYER
runs their office phone-operator style from the dashboard's مخابرات tab.

- [x] **P2a-T1** Enums + error codes: ConsultationMinutes(10|20|30),
  SubscriptionFeature (ai_chat, ai_filelab, ai_kitchen, ai_voice),
  QueueTicket lifecycle, WALLET_/QUEUE_/LAWYER_/TICKET_/PURCHASE_/
  SUBSCRIPTION_/COMMS_ with 4xx prefix-mapping.
- [x] **P2a-T2** Wallet (StorageProvider-persisted, per-user lock, idempotent
  topup credit on gateway session, honest insufficient-funds), Billing
  (catalog, buy consult / subscribe, duplicate-subscription shield, refunds).
- [x] **P2a-T3** ConsultationQueue: join with paid Unconsumed purchase only,
  online+open checked, ETA = sum of minutes ahead, next/skip/end lifecycle,
  cancel ⇒ wallet refund. lawyer moves land on the bus as queue.updated.
- [x] **P2a-T4** CommsSettings: SMS panel (kavenegar/ghasedak/smsir/custom)
  + call panel (baseUrl/accountId/token/fromNumber) persisted masked via
  StorageProvider; test endpoints do REAL HTTP and report latency.
- [x] **P2a-T5** NotificationService: in-app inbox per user + SMS via panel +
  outbound consult call at up_next; unwired panels stay honest (no fake
  delivered flags).
- [x] **P2a-T6** apps/client PWA: ۴ تب (فروشگاه، کیف پول، نوبت من، اعلان‌ها),
  manifest + offline-shell SW, install banner, live queue polling 12s.
- [x] **P2a-T7** دست داشبورد — تب «مخابرات مشاوره»: کلید آنلاین/آفلاین، باز/
  بستن صف با دلیل فارسی، نفر بعد، skip-to-end, ویرایش قیمت ۱۰/۲۰/۳۰،
  اتصال و تست واقعی پنل‌های پیامک/تماس.
- [x] **P2a-T8** +۲۴ jest (211 total), ADR-015, push. NOT YET: real payment
  gateway wiring, web push, E2E browser tests.

## Phase 2 — Data Lifecycle (چرخه حیات داده)

Autonomous collectors → validators → updaters. Trust tiers per SPEC §9.
Law versioning = temporal (valid_from/valid_to), never overwrite history.

- [x] **P2-T1** Migration 006: corpus tables from SPEC §5
  (`knowledge_sources`, `ingestion_jobs` incl. honest `partial_success`,
  `legal_documents` sha256-UNIQUE + `valid_from/valid_to` + `supersedes_id`,
  `document_chunks` vector(1536) placeholder, `corpus_versions`) + the P2a
  money tables (wallets/txns with balance CHECK + idempotency index,
  purchases, subscriptions, tickets, comms_panels, notifications).
  NOTE: `citation_links` / `retrieval_sessions` / `retrieval_results` defer
  to the P4c embedding phase — P2 grounding carries citations on `result.meta`.
  Rehearsal (`test:migrations`) needs a live DATABASE_URL — see ADR-016.
- [x] **P2-T2** `CollectorSourceAdapter` port + mock-first collector (ADR-017):
  `rooznameh-mock` emits deterministic tier-1 fixtures (with an official
  marker so the validator can pass) + a FAIL fixture so wire-failure counting
  is REAL code; sha256 hashed over the exact emitted rawText. Real
  روزنامه رسمی/پایگاه قوانین adapters plug the same interface later.
- [x] **P2-T3** `DataValidatorService` (corpus shelf IS the validator surface):
  sha256 recompute, min length, Persian ratio, tier-1 official-marker rule;
  `verified_at` written ONLY when every rule passes; Persian reasons leak out
  to the dashboard on rejection. No force-verify path exists (ADR-016).
- [x] **P2-T4** `LawUpdaterService`/temporal logic: identical sha256 = honest
  "no change"; new text on a known title closes the previous `valid_to` and
  appends the version with `supersedes_id` — history never overwritten.
  Effective-date SCHEDULING (collected for tomorrow) lands with P2-T5's worker.
- [x] **P2-T5** `IngestionWorkerService` state machine (queued → running →
  succeeded | partial_success | failed), persisted via StorageProvider.
  Job id = sha(sourceId, window) → same-window replay is a NO-OP; retry
  re-clocks the same row with `retryOf`; validator sits inside the loop and
  rejections list sha prefixes. Redis transport = later swap, API stable.
- [x] **P2-T6** Diagnostics surfacing: `GET /api/dashboard/corpus/diagnostics`
  (failed | partial_success | rejected runs + collector sources), `POST
  /sync` (sync now, idempotent per window), `POST /jobs/:id/retry`; the
  dashboard کتابخانه tab shows jobs + stats + retry buttons.
- [x] **P2-T7** Corpus grounding at dispatch (ADR-016): corpus search runs
  BEFORE the expert; verified hits fold into `task.context` and only then
  `meta.grounded=true` with `meta.citations[]` (title, tier, preview).
  No hit → no grounding costume. Deterministic tier-weighted scoring,
  verified-first, Persian-normalized.
- [x] **P2-T8** Dashboard «کتابخانه» tab: shelf vitals + trust-tier badges,
  deterministic search, paste-ingest, ingest-from-upload (full text via
  `shelfText` — OCR-needed flags surfaced, never imagined), validate-button
  with reasons. Bus events `corpus.ingested` / `corpus.validated` on the
  kitchen stream.

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
