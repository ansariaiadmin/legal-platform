# AGENTS.md — the front door of this repo

Any agent (human or AI, any session, any tool) that opens this repository MUST
perform this exact sequence before touching code. It takes under a minute and
is the reason work survives interruptions.

## 1. Read the brain (state engine)

```bash
node scripts/checkpoint.mjs status      # or: npm run agent:state
```

`scripts/agent_state.json` holds: current phase, completed/pending tasks,
architectural decisions, last checkpoint. It is committed to git ON PURPOSE —
it is the project's memory.

## 2. Read the docs, in this order

1. `docs/HANDOFF.md` — auto-regenerated summary of where we are (never edit by hand).
2. `docs/ROADMAP.md` — the phase-by-phase, task-by-task plan (`P{n}-T{m}` ids).
3. `docs/architecture_decisions.md` — ADRs; append-only.
4. `docs/SPEC.md` §11a — the agentic-layer product rules (deterministic-first
   routing, agents never call LLM SDKs directly, lawyer review is mandatory).

## 3. Resume protocol

- Work on the next pending task in order. Task ids are stable; reference them
  in commits (`P1-T2: add criminal expert capabilities`).
- After EVERY completed task:
  ```bash
  node scripts/checkpoint.mjs complete "P1-T2: ..."
  node scripts/checkpoint.mjs sync     # regenerates HANDOFF.md, commits if dirty
  ```
- Adding a task: `node scripts/checkpoint.mjs plan "P2-T7: ..."`
- Recording a decision: `node scripts/checkpoint.mjs decide "ADR-004" "..."`
  AND append it to `docs/architecture_decisions.md` (the human-readable twin).

## 4. Hard rules (SPEC §12)

- No provider-SDK calls outside `apps/api/src/providers/*`.
- No enum duplication — register shared terms in `packages/domain`.
- TDD: logic changes ship with tests; `npm test` must stay green.
- Never fabricate success: no fake auth/payment/AI/ingestion results, even
  behind flags. Placeholders must be honest (see `LegalExpertBaseAgent`
  which explicitly reports `grounded: false` until Phase 4).

## Layout map

```
apps/api        NestJS API (orchestrator lives in src/modules/orchestrator)
apps/web        Next.js App Router (Persian UI, i18n keys)
apps/agents/*   Expert agents; each has a capabilities.ts
packages/domain    enums + state machines (single home)
packages/shared    agent interfaces (IAgent, ISkill, IExpertAgent, ...) + utils
packages/contracts API error codes + DTO contracts
scripts/agent_state.json   ← the brain
scripts/checkpoint.mjs     ← the only sanctioned brain-mutator
```
