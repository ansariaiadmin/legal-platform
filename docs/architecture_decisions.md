# Architecture Decision Records

Numbered, append-only. Never edit a decision after the fact — supersede it with
a new ADR. `scripts/agent_state.json.architectural_decisions` mirrors this file.

---

## ADR-022: One binary, many countries — i18n engine, themes, tour, backup, and a bilingual international desk (P7, 2026-09-05)

**Status**: accepted · **Area**: productization / UX / ops · **Phase**: P7

**Context.** The owner's mandate: the platform must be re-skillable by ANY
operator in ANY country — bilingual fa/en, RTL⇄LTR, day/night, onboarding
with step-by-step examples and generous defaults, backup, and an
international-law desk - "کافیه فرد خارجی بیاد اسکیل‌ها رو کانفیگ کنه و به
رهبر بگه پلتفرم رو با انگلیسی ست کن".

**Decision.**
1. **One i18n engine, zero forks.** `apps/web/src/i18n` carries fa + en
   dictionaries where `fa: Record<keyof typeof en, string>` — TypeScript
   refuses a UI that drops a translation (the key-twin invariant is a
   COMPILE error, not a lint wish). Runtime prefs (locale+theme+tourSeen)
   live in ONE module store writing `<html dir/lang>` and
   `<body data-theme>`; first visit adopts the org's deployment-profile
   locale, afterwards the user's choice always wins (their voice outranks
   the org default).
2. **Onboarding is data, not components.** The tour is 11 declarative steps
   (key, title, body, tab, optional sample-action). Sample actions are
   CustomEvents (`tour:try:library`…) — the engine never pokes component
   internals, tabs fill themselves. Restartable per tab anytime via 💡.
3. **Backup is honest about scope.** `BackupService` round-trips every
   StorageProvider-backed key into one base64 JSON bundle
   (`schemaVersion`ed, per-key skip+report on restore, never half-written)
   and says IN THE PAYLOAD that SQL tables are NOT included. OWNER-only
   endpoints under `/api/dashboard/ops/backup*`.
4. **Config by conversation, for any country.** `DeploymentProfile`
   (defaultLocale/country/currency/timezone/legalSystem) persists beside
   brain config; `GET|POST /api/dashboard/config/profile`; config-intent
   parses BOTH languages — «پلتفرم را با انگلیسی ست کن» ≡ "set platform to
   English", «برای آلمان کانفیگ کن» ≡ "configure for Germany" — deterministic
   regexes first, always (SPEC invariant), confirm-gated through the Leader
   like every other config change.
5. **International desk is a citizen, not a plugin.**
   `apps/agents/international-expert` runs the same agent-kit as the
   Persian desks; its vocabularies are bilingual SO ROUTING IS SYMMETRIC
   (the test asserts an English query routes as well as its Persian
   equivalent). Persona carries `displayNameEn/mottoEn` (optional on
   `AgentPersona`) and the fleet cards render per the active UI locale.

**Honest limits, on the record.**
- The UI locale flip restyles/reroutes the DASHBOARD; agent *reasoning*
  language still follows whichever model serves the task. The corpus stays
  the corpus — switching to English does not translate Iranian law.
- Client PWA i18n marked as P7 follow-up (its dictionary ships English-capable
  keys; RTL for client pending).

**Tests** — 3 backup roundtrip/schema/corrupt-skip specs; 5 profile+intent
e2e specs (defaults, one-call Germany re-skin, refused bad locale, bilingual
intent parsing, intl agent in tree); 7 intl-expert unit specs. 291 jest
total, all agent-package suites green, web tsc clean.

---

## ADR-021: Standing guard — security as a resident agent, not a quarterly ritual (P6, 2026-09-05)

**Status**: accepted · **Area**: security / fleet governance · **Phase**: P6

**Context.** The user demanded: security at *a literal ten out of ten*, a
resident security agent continuously in charge, checked against *current*
standards, reporting to the Leader, and intelligence that survives total
cloud loss via the python workers. Audits-as-PDFs rot; a guard that runs
the checks every day does not.

**Decision.**
1. **The posture score is math on probes, not sentiment.**
   `standards.ts` pins 10 checks with real references (OWASP API 2023, ASVS
   4.0, CWE, NIST CSF 2.0) whose weights **sum to exactly 10** — jest pins
   the sum. `SecurityAuditService` *runs* each probe against the live
   configuration: headers middleware present, HSTS emitted only in prod,
   CORS free of wildcards, OTP throttling demonstrated by feeding the very
   RateLimitService OTP uses, global per-IP floor, placeholder-secrets
   boot-guard, machine-token hygiene (expired-live tokens get auto-revoked
   during the scan — the audit *repairs as it measures*), body bounds,
   worker liveness, scan freshness. `not_applicable` is excluded from the
   denominator, never awarded (a dev box can't score HSTS points it can't
   earn).
2. **The guardian is a fleet member, and it reports to the Leader through
   the shared bus.** `SecurityGuardianAgent` (kind `guardian`, field
   GENERAL) registers into the same `ExpertRegistry` — one tree, one
   dashboard. Every manual/scheduled/agent-initiated scan emits
   `security.scanned` with `posture=x/10`, counts, regenerated-vs-previous
   deltas, and the report id. Evidence strings NEVER ride the bus; they sit
   in the persisted report (StorageProvider ring of 60) behind
   LAWYER_OWNER/STAFF.
3. **Transport hygiene is enforced in one place used by prod AND tests**
   (`configureApp`): x-powered-by off, security headers as hand-written
   deterministic middleware (no dependency whose defaults we can't audit),
   global rate floor, and — found by our own spec — body-parser errors now
   map to `VALIDATION_MALFORMED_JSON`(400)/`VALIDATION_BODY_TOO_LARGE`(413);
   before this they surfaced as `SYSTEM_INTERNAL_ERROR` at 400, telling
   callers *our* server broke on *their* payload.
4. **Repo secret hygiene is a build gate.** `tools/security/secret-scan.mjs`
   scans git-tracked code for credential-shaped literals; jest runs it, so
   a leaked key fails CI AND local `npm test`. The scanner carries a
   `--self-test` so a broken regex can't masquerade as a clean repo.
5. **Python workers are a first-class availability surface— AND the
   intelligence floor.** Three new stdlib-only tools:
   - `ping` liveness/provenance (version, uptime, configured-model flags);
   - `security_scan` — deterministic regex rules over caller-supplied files
     (the worker never reads disk itself);
   - `local_answer` — BM25-lite extractive QA.
   When every AI provider fails, `DraftingService` falls back to
   `local_answer` over the JUST-retrieved corpus hits: output header says
   plainly it is extraction, not composed advice; `provenance.model =
   'local_rules_extractive'`, `degraded: true`; and — this matters most —
   the draft still lands in **awaiting_review**: the lawyer gate is never
   bypassed by a rescue path. Workers down + provider down ⇒ the OLD honest
   `DRAFT_AI_UNAVAILABLE`, never invented spans.

**Tests** — 31 new jest specs (headers/CORS/429/400/413 envelope, standards
weights, every probe family incl. wildcard-CORS fail and zombie-token
auto-revoke, persistence+deltas, bus reporting, routing, scheduler state,
secret-scan gate + self-test, degraded drafting ×3) and 8 new python specs.
283 jest + 45 py green.

**Consequences.** "10/10" is now a number the platform computes about
itself; when reality drifts (a token without expiry, CORS loosened, workers
silent) the number drops and the owner SEES it drop, with Persian
remediation text per check. Extensions = append a StandardCheckDef + probe.

---

## ADR-020: The surface er kümmert sich um Notarization — OpenAPI everywhere, SSE for drafts, machine tokens with math, i18n keys (P5, 2026-09-05)

**Status**: accepted · **Area**: API surface / SDK-readiness · **Phase**: P5

**Context.** Phase 5 asked the platform to be consumable identically from
Web/Next APIs, Telegram mini-app, telephone — which needs: documented
contracts, live progress channels, non-human credentials, and Persian
strings living in ONE place.

**Decision.**
1. **OpenAPI is enforced by test, not by hope.** `test/app/openapi.spec.ts`
   boots the whole app graph and asserts the P2–P5 surfaces exist in the
   generated document AND carry their `ApiTags`; a missing tags/decorator is
   a build failure, not a wiki to-do. Notes: global `/api` prefix is part of
   the published path (the doc matches reality).
2. **SSE is the only live channel for delivery.** P5-T2 adds
   `GET /api/dashboard/rag/drafts/:id/stream` — snapshot first, then bus
   events filtered by draftId; stream COMPLETES on terminal draft state
   (approved/rejected) or at 120s. No abandoned sockets, no busy polling.
   The kitchen-bus stays the fleet-wide stream; per-draft is scoped-on-id.
3. **Machine tokens, done mathematically.**
   `MachineTokensService`: token = `lpm_<uuid>_<HMAC32>` where
   sig = HMAC(secret, `id|scopes|expiresAt`). Scopes from a CLOSED vocabulary
   (`client:read/write`, `drafts:read/write`, `events:stream`) — unknown
   scope = issue-time throw. Store via StorageProvider; `verify` uses
   `timingSafeEqual`. Revocation persists across restarts; `lastUsedAt`
   updates recklessly honestly. `MachineTokenGuard` + `@MachineScope()` +
   `@MachineOnly()` compose with `JwtAccessGuard` (a human JWT passes through
   unless the route is machine-only). Failures map to
   `MACHINE_TOKEN_REQUIRED|INVALID → 401` through the shared envelope —
   a missing entry in error codes would have leaked as 500, which the
   exception-filter contract test proved its worth by CATCHING.
4. **i18n sweep begins from the newest tabs.** `library.*`, `drafts.*`,
   `machines.*` keys land in the fa dictionary; tab headings read from t().
   The full back-sweep of older literals is acknowledged as ongoing P6 work
   — keys were gate-kept so NEW strings never again bypass the dictionary.

**Tests** — 9 new supertests: token issue/verify math, wrong-scope denial,
tamper death, expiry death, restart-persistent revocation, closed scope
vocabulary, machine-only lanes, OPENAPI path+tag coverage.

---

## ADR-019: Citation is the entry fee — composable retrieval, provenance-bound drafting, money metering (P4, 2026-09-05)

**Status**: accepted · **Area**: RAG pipeline / drafting · **Phase**: P4

**Context.** SPEC §9's drafting law: ingest → normalize → chunk → embed →
retrieve → rerank → draft WITH citations → **lawyer review mandatory**. P4
also owed metering (usage_records + monthly alert) and review console API.

**Decision.**
1. **Composable retrieval pipeline.** `EmbeddingIndexService` (cosine over
   `providers/ai` embeddings, dimension from PROVIDER metadata — never
   hardcoded 1536) feeds the same candidates' pool as lexical
   `CorpusService.search`; `RerankerService` fuses BOTH with config-driven
   weights (`RAG_RERANK_WEIGHTS` JSON: lexical/vector blends + tierBoost
   table + recency half-life). Evolvable: swap the vector store for pgvector,
   the blend weights, or add BM25 — the same contract surface stays.
2. **Citations carry COVERAGE, not merely existence.** `SearchHit.matchedTerms`
   counts DISTINCT query terms a document covers; drafting refuses entry
   unless the top hit covers ≥2 distinct terms (`REVIEW_MIN_TERM_COVERAGE`)
   AND retrieval is non-empty (≥ REVIEW_MIN_CITATIONS). Otherwise the draft
   lands back in `created` with `DRAFT_NO_CITATIONS` — a lone «قانون» word
   can never feather a law.
3. **State machine is domain-typed, and you can NEVER fork it.**
   `DraftRequestState` from `packages/domain` governs with an `ALLOWED`
   transition table: created → retrieving → generating → awaiting_review →
   approved | rejected; approved → superseded (spawning a fresh `created`
   successor linked by `supersedesId`). `DraftRequestState` in the domain
   package has NO `failed` member, and SPEC §4 forbids local forks — so a
   blocked/failed run returns to `created` with `error` set (re-runnable).
4. **AI output is never sold as fact.** The citation-required system prompt
   demands a numbered منابع section; after generation we verify which
   `[n]` tags the model actually referenced and keep only those in the
   provenance bundle (`retrieved[]` reflects what was ACTUALLY cited, not
   what was on offer).
5. **Metering as a toll booth.** Every paid call passes
   `UsageMeterService.recordCall` (drafting/tiebreak/embedding), rolled
   monthly per (feature, model); pricing from `AI_TOKEN_PRICING_USD` (missing
   price ⇒ cost null, never invented); `AI_MONTHLY_ALERT_THRESH_USD` crossing
   fires `usage.alerted` once per day max.
6. **Dashboard consumables**: `GET|POST /dashboard/rag/index/rebuild`,
   `GET /drafts`, `POST /drafts/:id/generate`, `POST /drafts/:id/review`,
   `GET /usage/monthly`; plus the «پیش‌نویس‌ها» tab with provenance tiles.
7. **SQL shapes now** (migration 007: draft_requests w/ state CHECK + supersede
   FK + jsonb provenance, draft_reviews, usage_records UNIQUE(month,feature,
   model)) — runtime still StorageProvider-persisted; production swap touches
   storage only.

**Tests** — `test/rag/rag-pipeline.spec.ts` (9 suites: honest empty index,
cosine ranking, deterministic rebuild, tier boost & env-weights, blocked
drafts, full review pipeline inc. illegal-hop errors, metering rollup and
one-a-day alert).

---

## ADR-018: The Leader asks twice only when confused — bounded LLM tiebreak, budget gates, honest memory (P3, 2026-09-05)

**Status**: accepted · **Area**: orchestration / dispatch · **Phase**: P3

**Context.** Layered AI (SPEC §9) says deterministic first, LLM second. The
Planner tree had a `needsLlmTiebreak` FLAG since Phase 1, but nothing ever
paid it off: no LLM consultation existed, no per-feature budget existed,
and conversation memory died with the process. Phase 3 completes the loop.

**Decision.**
1. **The tiebreaker is a service, not a mood.** `LlmTiebreakerService.resolve`
   fires ONLY when the deterministic classifier returns confidence <
   LOW_CONFIDENCE. The prompt demands a single JSON object; response is
   regex-extracted, schema-validated against the REAL `LegalField`/`IntentKind`
   enums (out-of-vocab = `llm_rejected`); a valid answer bumps confidence to
   exactly `LOW_CONFIDENCE+0.15` — a hint's-worth, never a crown. Every call
   records an outcome: `not_needed | unavailable | skipped_privileged |
   llm_rejected | llm_applied`.
2. **Secrecy law beats even the agent who's "just asking who to call".**
   `sensitivity: 'privileged'` → outcome `skipped_privileged` BEFORE any
   network activity; no probe, no bytes leave the box (ADR-004 §11a-i).
3. **Per-feature budget is a gate, not an afterthought** (`BudgetGateService`):
   quotas from `AI_FEATURE_QUOTA_TOKENS` JSON map; spend per (feature, UTC
   day) persisted via StorageProvider (`runtime/budget/*`); `check('tiebreak')`
   runs BEFORE any paid call, and a spent-over-quota feature flips to
   deterministic-only — the dispatcher simply skips the consult and the live
   stream says so.
4. **Memory is honest about its horizon.** `SessionMemoryService` keeps the
   last ≤10 turns per user with a 30-minute TTL evaluated AT READ TIME
   (no fake persistence, no memory of a restart-stale thread); it persists
   per user (`runtime/sessions/<user>.json`) so the Leader conversation
   RESUMES after a server restart. API: remember / recall / contextLines /
   clear — no more.
5. **Route carries its defense**: every candidate the tree walk considered
   is returned as `trace[]` (P3-T5) — exposed via `POST
   /dashboard/orchestrator/dry-run` so the dashboard shows WHY the chosen
   expert won (dry-run never executes a grant-gated dispatch).

**Consequences.**
- Routing is now double-entry accountable: deterministic vocabulary first,
  wits-paid LLM second, both visible on the kitchen stream.
- Mock adapter power: tiebreak works sandbox-wide with the mock AI
  provider plumbing already present — provider-swap out of scope of belief.

**Tests** — `test/orchestrator/p3-tiebreak-memory.spec.ts` (11 specs:
tiebreak never-fires-on-confident, happy apply, JSON garbage/out-of-enum
rejection, privileged skip, providerless honesty, budget exhaust/recovery
across restarts, TTL expiry, restart continuity, window cap).

---

## ADR-017: Collection loop — mock-first adapters, a state machine that owns up to halves, retry that links back (P2, 2026-09-05)

**Status**: accepted · **Area**: corpus / ingestion · **Phase**: P2-T2/T5/T6

**Context.** The remaining half of SPEC §9 was the LOOP: scheduled collection
from official sources, an ingestion worker handling mixed windows honestly
(success N of M is PARTIAL, not success), and operator diagnostics with
manual retry. The roadmap names Redis as the queue transport; the sandbox
has no Redis — but the lifecycle and its accounting are the PRODUCT, not
the transport.

**Decision.**
1. **Collector adapters, mock-first.** `CollectorSourceAdapter` is the port:
   `fetchLatest(windowLabel)` returning `{canonicalTitle, bodyRaw}[]`. The
   shipped mock (`rooznameh-mock`) emits two deterministic tier-1 fixtures
   (with the official «روزنامه رسمی» marker so the validator CAN pass them)
   plus a `FAIL` fixture that simulates a wire failure — failure counting is
   exercised by the fixtures themselves, so partial_success behavior is
   REAL code under test, not a logging belief.
2. **The same sha the validator re-checks is the sha of the SHIPPED text.**
   A subtle honesty rule discovered in tests: hashing `bodyRaw` while
   shipping `title + bodyRaw` fails provenance. The collector hashes the
   exact bytes it emits (`contentSha256` over the emitted `rawText`).
3. **State machine**: `queued → running → succeeded | partial_success |
   failed`, persisted via StorageProvider (`runtime/corpus/jobs.json`) with
   `attempted/succeeded/failed` counts. Job id = sha256(sourceId, window)
   → re-running the same window REPLAYS THE SAME JOB as a no-op; a manual
   retry re-clocks the same row with `retryOf` pointing at the previous
   attempt — history of attempts, never multiplied jobs.
4. **Validation inside the loop.** Every collected item that lands on the
   shelf is passed through `DataValidatorService`; failures LIST the sha256
   prefix in `rejectedIds` for the diagnostics surface (no silent green
   ticks; ADR-016 rule 2 applies inside workers too).
5. **Diagnostics is a READ model**: `GET /api/dashboard/corpus/diagnostics`
   returns failures (failed | partial_success | validator-rejections) +
   available collector sources; `POST /api/dashboard/corpus/sync` runs a
   window NOW; `POST /api/dashboard/corpus/jobs/:id/retry` re-runs linked.
   The Redis transport upgrade swaps the service internals; the API and
   state machine stay.

**Tests** — `test/corpus/collector-worker.spec.ts` (5 specs: fixture
counting, partial_success auto-verify, idempotent replay, retry linking,
per-window job separation).

---

## ADR-016: The corpus shelf — trust tiers, validator-only ticks, temporal truth, deterministic grounding (P2, 2026-09-05)

**Status**: accepted · **Area**: corpus / RAG · **Phase**: P2 (data lifecycle)

**Context.** SPEC §9 demands law be INGESTED as data, never recalled from a
model: trust tiers (1 official / 2 office-approved / 3 general), sha256
provenance, `verified_at` set ONLY by a validator, `valid_from`/`valid_to`
temporal versioning, and answers grounded in retrievable chunks with the
source named. Phase 2 builds that shelf.

**Decision.**
1. **Storage split** — relational SHAPES are written NOW (migration 006:
   `knowledge_sources`, `legal_documents` with `sha256 UNIQUE` +
   `valid_from`/`valid_to` + `supersedes_id`; `document_chunks` with a
   `vector(1536)` placeholder on pgvector; `ingestion_jobs` with an honest
   `partial_success` state), while the RUNTIME corpus persists through the
   StorageProvider port (`runtime/corpus/store.json`). The service code is
   storage-agnostic; the production swap touches storage only, never truth.
2. **The validator is the only pen for the green tick.** CorpusService owns
   no "force verify" path; `DataValidatorService.validate` checks body
   length, recomputes sha256, enforces a Persian-content ratio, and for
   tier 1 REQUIRES an official-publication marker («روزنامه رسمی» /
   «مجلس شورای اسلامی» …). Failure returns human-readable reasons the
   dashboard shows verbatim (ADR-013/1e honesty).
3. **Temporal append, never overwrite.** Re-ingesting a canonical title
   closes the previous row's `valid_to` and appends the new version with a
   `supersedes_id` pointer; identical sha256 in the same title is an honest
   "no change" (`LawUpdaterService.applyUpdate`). "The law as of day X"
   stays answerable.
4. **Deterministic retrieval.** `CorpusService.search` = zero-cost term
   scoring + exact-phrase bonus + title bonus, weighted by trust tier
   (1→×1.6, 2→×1, 3→×0.5), over NORMALIZED Persian (ك→ک, ي→ی, دو-فاصله/ZWNJ
   می‌لغد). Search defaults to verified-only; `?all=true` is the explicit
   escape hatch. pgvector lands in P4c; the contract surface stays stable.
5. **Grounding is a pre-dispatch fold, not a post-hoc costume.** The
   orchestrator asks the corpus BEFORE any expert runs; real hits are
   appended to `task.context` as attributed lines («منبع معتبر …») and ONLY
   then does `result.meta.grounded = true` with `meta.citations[]`
   (title, tier, preview). No hit → no grounding claim. LLM text is never
   rebranded as sourced fact.
6. **Module topology**: `CorpusModule` is intentionally bus-fed from
   OrchestratorModule via `forwardRef` (`corpus.ingested`/`corpus.validated`
   events on the kitchen stream) while OrchestratorModule consumes
   `CorpusService` for grounding — a declared two-way reference pinned by
   forwardRef, NOT hidden plumbing; the dashboard controller lives in
   `CorpusApiModule` above both, because it also needs
   `FileIntelligenceService.shelfText()` (P2 adds FULL text extraction for
   shelvers; analysis previews stay 400 chars for chat).

**Consequences.**
- 24 dashboard queries can show «چرا رد شد» instead of «خطا» — validator
  reasons are Persian, end to end.
- Grounded answers carry a citation list the UI can render without parsing.
- Honest NOT-YET list: no collector AGENT loop yet (P3 wires scheduled
  collection with per-source quality decay), embeddings are a placeholder
  column until P4c, `test:migrations` needs a live DATABASE_URL (the
  sandbox has none; 006 shipped after tsc + import checks like 001–005).

**Tests** — `apps/api/test/corpus/corpus-grounding.spec.ts` (5 specs:
dedupe-by-sha256, verified-only search, validator rejections with reasons,
temporal supersession, dispatch grounding on/off).

---

## ADR-015: Commerce, the consultation queue and the wired office (P2a, 2026-09-05)

**Context.** The day-one public business is a click-and-pay product: from a
CLIENT-side site (its own origin, PWA-installable) — signup by OTP, charge the
wallet, buy a 10/20/30-minute slot, join the line, learn your place by SMS +
in-app. The LAWYER toggles telecoms («آنلاین/آفلاین»), opens/closes the queue,
sets prices. AI features sell as PER-PART subscriptions (هر قسمت اپ یه اشتراک).

**Decision.**
- `WalletService` — balances + txns persisted through the StorageProvider
  port (`runtime/wallet/<user>.json`, capped 500 txns); every mutation runs
  under a per-user promise lock; top-up crediting is IDEMPOTENT on the
  gateway session (replay-safe); debit below balance refuses with
  WALLET_INSUFFICIENT_FUNDS (402-class, not a silent negative).
- `BillingService` — shop catalog: consultation plans (+lawyer-editable) and
  subscriptions keyed by `SubscriptionFeature` (`ai_chat`, `ai_filelab`,
  `ai_kitchen`, `ai_voice`) with 1/3/12-month prices. Duplicate ACTIVE
  subscription per feature is refused (409). Every wallet path carries an
  externalRef so audits can replay the money story.
- `ConsultationQueueService` — the telecoms box: join only with a paid
  UNCONSUMED purchase and only while `online && queueOpen`; position = honest
  (sum of plan-minutes ahead); lifecycle `waiting → up_next → in_call →
  done|no_show|cancelled(refund)`; lawyer has next/skip/open/close/end; every
  motion lands on the agent bus as `queue.updated` so the kitchen shows the
  line.
- `CommsSettingsService` — the lawyer brings THEIR SMS panel (Kavenegar /
  Ghasedak / SMS.ir / custom URL) and THEIR call panel; keys persist via
  StorageProvider, never leave the view except masked; «تست واقعی» hammers
  the configured endpoint with a real request and reports latency/error —
  no painted green.
- `NotificationService` — per-user in-app inbox + SMS via the panel +
  outbound call via telephony port when a ticket reaches `up_next` ("نوبت
  توئه" + live-link). If nothing is wired (sandbox default) the SMS/call
  paths silently hold their fire — in-app tells the truth.
- Error codes new in `packages/contracts/src`: WALLET_*, QUEUE_*,
  LAWYER_*, TICKET_*, PURCHASE_*, SUBSCRIPTION_*, COMMS_* — prefix-mapped to
  4xx via httpStatusForCode, PAYMENT_GATEWAY_ERROR → 502 next to PROVIDER_*
  (the same rule as all upstream failures).

**Consequences.** +24 jest (187→211). apps/client PWA (own server, port
3100, manifest + SW + install banner, RTL fa) sells plans & subscriptions,
charges the wallet, joins the queue WATCHING it update every 12s, reads
in-app notifications marked unread-first. Dashboard gains the «مخابرات
مشاوره» tab: online/offline switch, queue gate, نفر بعد, پنل‌ها, plan
pricing, comms testers.

Still NOT done: payment gateway in production mode (mock only), push
notifications (push port exists, adapter mock), Google OAuth, E2E browser
suite. Postgres migration for these tables aligns with P2-T1.

---

## ADR-014: The owner configures the platform BY TALKING to it (P1f, 2026-09-05)

**Context.** The product bar was: «با تب بندی تمیز یه بچه دو ساله هم بتونه
پلتفرم رو کانفیگ کنه» — maximum self-service: connect an API/local model to
the Leader, pick a tier, and visually WATCH the agents at work. Developer
touching env files is Failure.

**Decision.**
- `ConfigHubService`: brain overrides (local baseUrl/model; cloud
  baseUrl/model/apiKey) persist via the StorageProvider port at
  `runtime/brain-config.json`; runtime beats env; secret keys only ever leave
  as `••••last4`; presets (`spartan|counsel|senator`) map to hybrid policy.
  `HybridInferenceRouter` reads `configHub.peek()` FIRST — the secrecy law
  (privileged → never cloud) is above this layer and has no dashboard switch.
- **Conversational config**: deterministic Persian regexes parse intents
  («به مدل محلی وصل شو آدرس …», «کلید ابری رو تنظیم کن …», «تیر سناتور رو
  فعال کن») into PROPOSALS; nothing applies until the owner confirms («بله»
  or the green button → `POST …/leader/config-proposals/:id/accept`,
  audited `orchestrator.leader.config`). No LLM sits between the office and
  its safety levers.
- **Sandbox door**: `DEV_DASHBOARD_TOKEN` + `NODE_ENV≠production` ⇒ a fixed
  `dev-owner/lawyer_owner` identity. The production check short-circuits
  BEFORE the token comparison, so the env var is inert in prod.
- **Live kitchen**: SSE encrypted by the JWT guard → browser EventSource
  cannot carry headers, so Next route `/stream/events` proxies with
  `node:http` RAW (Next's patched fetch BUFFERED the stream — a silent
  death for liveness; documented in the route file).
- Dashboard: Next.js 14, fa/RTL, tab shell (`خانه/اتصال مغز/ناوگان/چت با
  لیدر/فایل‌ها/آشپزخانه زنده`), no UI libs — hand-rolled CSS; zero new
  dependencies added (only dev-time `@types/multer`).

**Consequences.** +21 jest (188→187+? actual: 172→187 = +15 config-hub,
config-intent, conversation proposals: 172→187), web build green, SSE tunnel
verified live in the sandbox preview; docs updated.

---

## ADR-013: Uploaded files → Leader conversation sandboxes (P1e, 2026-09-05)

**Context.** The office's real life happens in files owned by lawyers: scissors,
staples and "دادن یک فایل به لیدر و باهاش گفت‌وگو کردن" — قرار گرفتن هر فایل هرجایی
needs **content-aware placement**. A file is not a chat message; it is an object that
the Leader reads FIRST, then answers FROM its TEXT, then suggests where it should
live so agents can use it.

**Decision.** `FileIntelligenceService` — uploads land in the StorageProvider port
(`uploads/<sha256-prefix>/<safeName>`), sha256-digested BEFORE any interpretation,
THEN extracted. The python sidecar (`worker.py` tools `file_digest`/`extract_any`,
pure stdlib, zero deps) is preferred: magic-byte dispatch, `PK³` zip → docx (strip
Word XML), `%PDF` → regex over `Tj/TJ` streams with FlateDecode, scanned PDFs
HONESTLY marked `needs_ocr` (never invented text). If the queue is down, the TS
inline pre-read handles text files only (no false extraction of binaries) and the
record declares `status: 'completed_inline'` — ROUTE A: honest degradation stays
the law (SPEC §2).

`PlacementService` — computes content-vs-fleet affinity with the EXACT SAME
`vocabularyScore` the routing tree uses; a file walks toward the agent that would
answer its questions. Unmatched (score < 0.3) lands in `needs-review` instead of a
confident lie.

`LeaderConversationService` — text chat + voice chat (hear → chat → speak) routed
through the governed dispatch path **without bypassing grants** (SPEC §11a law).
Conversations are owner-scoped, in-memory (roadmap P3 pins durable persistence),
turns trimmed at 100 per session.

**Consequences.** Tests: 6 file-intelligence + 6 conversation (172 jest total). The
dashboard now sees `file.uploaded`/`file.analyzed`/`conversation.turn` SSE events.

---

## ADR-000: The Agentic Layer is real and pinned in SPEC (2026-09-05)

**Context.** The platform brief (SPEC §1) lists an "AI workspace (RAG + drafts)"
module, but v1 of the code shipped no agents at all — only the provider
abstraction and pgvector extension. The user commissioned a decentralized,
multi-agent ecosystem ("Expert Tree + Data Lifecycle + Orchestrator").

**Decision.** We build it, but adapted to SPEC instead of contradicting it:
SPEC gains an `Agentic Layer (v1.1)` section so the single source of truth
never lies. Agents never bypass SPEC §8/§9: all AI access through
`providers/ai` adapters, deterministic-first routing, mandatory lawyer review
for any draft, source trust tiers.

**Consequences.** `apps/agents/` becomes a third app family next to
`apps/{api,web}`. Root `package.json` workspaces gain `apps/agents/*`.

## ADR-001: File-backed State Engine as cross-session memory (2026-09-05)

**Context.** Work on this repo happens in bounded agent sessions (possibly
different models/tools each time). Without durable state, every session
re-discovers the plan and risks divergent architecture.

**Decision.** `scripts/agent_state.json` is the single machine-readable brain
(current phase, tasks, ADRs, last checkpoint). `scripts/checkpoint.mjs` is the
only sanctioned mutator: zero-dependency ESM Node (v22-native), idempotent
commands (`status|complete|plan|decide|phase|sync`), regenerates
`docs/HANDOFF.md` on every mutation, `sync` commits when the tree is dirty.
The state file ITSELF is committed to git — it is the memory, so it must be
versioned like code.

**Consequences.** Slight git noise (state churn); accepted as the cost of
continuity. `[skip ci]` on checkpoint commits until CI needs them.

## ADR-002: Agents live in apps/agents/{branch}, not packages/ (2026-09-05)

**Context.** The commissioning prompt said `apps/agents/{branch_name}`. SPEC's
v1 repo layout knew only `apps/{api,web}` and `packages/*`.

**Decision.** Follow the prompt: agents are apps (runnable units with a
`capabilities.ts` entry contract each), not libraries. `packages/shared` holds
the interfaces; `packages/domain` the enums. An agent MAY later be promoted to
a package if multiple apps need to import it — promotion, not birth.

## ADR-003: Deterministic-first routing; LLM as bounded fallback (2026-09-05)

**Context.** SPEC §9 mandates "Layered AI: deterministic automation first; LLM
only for high-value tasks." An LLM-first router would burn budget and
nondeterminism on every request.

**Decision.** Intent classification is a weighted keyword/structure scorer
(Persian + English) with typed output. The AIProvider is consulted ONLY below
a confidence threshold, returning schema-validated JSON. Budget exhaustion
forces deterministic-only mode (roadmap P3-T4), never a hard failure.

## ADR-004: Hybrid local/cloud inference, privilege never leaves the box (2026-09-05)

**Context.** Different customers have different wallets: some can afford cloud
models, some must run a local GPU model, most want both. And Iranian client
data is privileged — sending it to a cloud endpoint is a confidentiality breach.

**Decision.** `HybridInferenceRouter` (`modules/orchestrator/hybrid-inference-
router.ts`) decides per-task via `AI_HYBRID_POLICY`: `local_only` |
`cloud_only` | `hybrid_local_first` (default) | `hybrid_cloud_first`.
Hard invariant wired into code: `sensitivity=privileged` ⇒ `target=local`,
even when local is degraded — it degrades loudly, never silently reroutes to
cloud. Budget exhaustion demotes hybrid policies to local. Every decision is
emitted to the live event bus with its reason + signals so the dashboard
shows exactly WHERE an answer was computed.

## ADR-005: Governed sub-agents — grants, never ambient authority (2026-09-05)

**Context.** The Leader managing sub-agents requires *secure, delegable
access*: the human office owner must be able to let "the civil expert draft
contracts" without giving it the keys to validate the corpus.

**Decision.** `AgentGovernanceService`: capability-scoped `AgentGrant`s with
mandatory `expiresAt`, issued only by `LAWYER_OWNER`, revocable instantly,
audit-logged. Dispatch without a grant ⇒ `AI_AGENT_NOT_AUTHORIZED`. A hard
per-agent disable switch overrides even live grants. Phase-1 store is in-memory
deliberately: a process restart revokes everything (fail-safe direction);
persistence lands with the governance migration in P5-T3.

## ADR-007: One genome per society — createExpertAgent kit (2026-09-05)

**Context.** Four branch experts (civil/criminal/family/registration) all
started as copies of the base skeleton. Copy-paste fleets drift; a luxury
product cannot drift.

**Decision.** `createExpertAgent(spec)` in `packages/shared/src/agent-kit.ts`
is THE ONLY sanctioned way to build an expert. Per-member deltas are exactly
three things: `capabilities.ts` (vocabulary), `persona`, `version`. Shared
law — `requiresReview=true`, honest `grounded` flags, thresholded routing,
closure-safe execute, compound-phrase-weighted `vocabularyScore()` — lives in
one file. A bug fixed in the kit is fixed for the whole society at once.

## ADR-011: Model matrix with Leader-lending (2026-09-05)

**Context.** `AGENT_TIER` sets policy, but the owner needs per-agent control:
civil on the fast local box, criminal on the bigger cloud model, the base
expert unassigned... and someone must catch the agent that has NO model
configured at all.

**Decision.** `ModelAssignmentService` holds owner-pinned (agentId → target,
model) pairs, editable from the dashboard (`POST/DELETE
/dashboard/orchestrator/models/:agentId`). `HybridInferenceRouter` got a
third input (`agentId`) and a strict precedence: **secrecy law** (privileged
never cloud, even against a manual pin — flagged loudly as
`privileged_overrides_manual_pin`) → **manual pin** → **Leader lending**.
Lending is explicit, not silent: the decision carries
`assignmentSource: 'leader_fallback' | 'manual' | 'policy_direct'` and the
concrete `model`, both emitted to the live stream so the owner always sees
*which brain boiled the answer*. Unassigning an agent reverts it to lending.

## ADR-012: One RESP client per language (2026-09-05)

**Context.** The T2 workers bridge API↔python over Redis. Every Redis call in
the repo already rode raw sockets (`redis.ping.ts`); two full SDKs (ioredis
+ redis-py) would double supply-chain surface for three commands.

**Decision.** One minimal RESP codec in TS (`providers/queue/redis-resp.client.ts`)
and its sibling in Python (`pylegal/resp_client.py`) — same three commands
(LPUSH/GET/SET-EX), same queue key, same result-key convention
(`legal:workers:result:<jobId>`, TTL 1h). `PythonWorkerService.enqueue`/
`result` is the only Nest touchpoint; queue-down degrades to `queued:false`,
never a fabricated result. Swap to a real library later behind THIS class.

## ADR-008: Fleet self-evaluation loop (2026-09-05)

**Context.** A society that cannot see its own performance decays silently.
The owner asked: who detects WHEN an expert got weak or strong, tells WHY,
and proposes what to change?

**Decision.** Two services under the Leader. `MetricsAggregatorService`
consumes the live event bus into per-agent rolling stats (success rate,
latency, route score, local/cloud split, denials). `EvaluatorService` reads
those stats deterministically (ADR-003 rules again: no LLM for judgment of
peers) and emits ranked Persian memos — split_vocabulary, tune_hybrid_policy,
review_grants, spawn_role, ... — each WITH evidence and a confidence score.
The evaluator is read-only BY CONSTRUCTION: it can suggest, never act.

## ADR-009: Runtime evolution — spawning members, never silently (2026-09-05)

**Context.** "The Leader must grow new roles." Runtime-generated agents are
powerful and dangerous: an unsandboxed factory is an authority bypass.

**Decision.** `EvolutionService` (POST /dashboard/orchestrator/spawn) is the
only womb. Guardrails: LAWYER_OWNER role only; strict validation (kebab id
ending -expert, LegalField membership, ≥3 vocab terms per skill); every spawn
uses `createExpertAgent` (ADR-007) so society DNA is inherited at birth;
spawned members wear the `-spawned` version suffix, start with ZERO grants
(i.e. cannot execute anything until explicitly granted), and are audible on
the live event stream + audit log if removed by `retire` (core fleet members
cannot retire — only spawns). Persistence is process-memory until the
registry migration (P1-T6); restarts remove spawns loudly, never resurrecting.

## ADR-010: Python sidecar workers, stdlib-only (2026-09-05)

**Context.** Persian text chores (normalization, chunking, citation regex)
are deterministic CPU work. Giving them to an LLM is wasteful; doing them in
the request path slows the API.

**Decision.** `apps/workers/py/pylegal`: pure-stdlib Python package (no pip —
zero supply chain), talking to Redis via a 120-line RESP2 client over raw
sockets, mirroring the API's own philosophy (`redis.ping.ts` does PING by
socket for the same reason). Contract: BLPOP `legal:workers:queue` ⇒ JSON
`{jobId, tool, input}` ⇒ SET `legal:workers:result:<jobId>` (TTL 1h). The
worker is a *toolbox*, never a decision-maker — authority stays with the
orchestrated fleet.

## ADR-006: Live ops stream — agents cook in the open (2026-09-05)

**Context.** The lawyer trusts what they can see. "پشت صحنه چه خبره" must be
a first-class dashboard experience, not a log file.

**Decision.** Every orchestrated step emits a serializable `AgentEvent`
(task.accepted/classified/routed → inference.decided → skill.started/completed|
failed; grant.issued/revoked) onto an `InProcessAgentEventBus` with a 200-event
ring buffer. The dashboard paints from `GET …/events/recent` and tails
`GET …/events/stream` (SSE). Event shapes stay plain-JSON so the bus can move
to Redis pub/sub (P5-T2) without touching emitters or consumers.
