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
