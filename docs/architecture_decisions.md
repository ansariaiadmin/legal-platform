# Architecture Decision Records

Numbered, append-only. Never edit a decision after the fact — supersede it with
a new ADR. `scripts/agent_state.json.architectural_decisions` mirrors this file.

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

## ADR-006: Live ops stream — agents cook in the open (2026-09-05)

**Context.** The lawyer trusts what they can see. "پشت صحنه چه خبره" must be
a first-class dashboard experience, not a log file.

**Decision.** Every orchestrated step emits a serializable `AgentEvent`
(task.accepted/classified/routed → inference.decided → skill.started/completed|
failed; grant.issued/revoked) onto an `InProcessAgentEventBus` with a 200-event
ring buffer. The dashboard paints from `GET …/events/recent` and tails
`GET …/events/stream` (SSE). Event shapes stay plain-JSON so the bus can move
to Redis pub/sub (P5-T2) without touching emitters or consumers.
