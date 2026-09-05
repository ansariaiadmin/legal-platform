# Adversarial Field Review — heaviest possible critique
Date: 2026-09-05 · Reviewer: Arena Agent Mode (internal hostile audit) · Scope: full platform, "attack first, defend later" posture
Standard: findings must cite file:line evidence, carry an exploitation sketch, and end in a concrete remediation. Known-by-design items are marked KBD and not re-litigated.

---

## Verdict in one line

The platform is unusually honest and well-hardened **in the lanes it covers** — but several lanes it *claims* to cover (money, multi-replica accountant, SSE auth, outbound AI egress) are structurally broken or exploitable today. Six items below would be found either by the first real paying user (money), or by the first competent red teamer (SSRF, SSE token, wallet race). Own them before the field does.

---

## SEV-0 — field-blocking (break under real users, no attacker needed)

### 1. ZarinPal top-up is broken at runtime by an internal contract mismatch
**Evidence:** `apps/api/src/providers/payment/zarinpal.adapter.ts:106-110` — `queryPaymentStatus` throws `UNSUPPORTED_OPERATION` (deliberately: "verify IS the read"). But `apps/api/src/modules/billing/wallet.service.ts:109` — `topupConfirm()` calls `await this.payment.queryPaymentStatus(sessionId)` and never catches the throw.
**Scenario:** Lawyer configures `PAYMENT_ADAPTER=zarinpal`, pays at the gateway, returns, dashboard polls confirm → every confirmation 500s with a ProviderError. Money left, no credit. This survives review because the local adapter (used in all tests) *does* implement `queryPaymentStatus`.
**Root cause:** two contracts pretending to be one. The wallet says "query status"; ZarinPal's domain says "verify callback". The callback path (`/billing/zarinpal/callback`) verifies properly — the confirm-by-session path is the orphan.
**Fix:** `topupConfirm` must resolve a pending session via `verifyCallback({ authority, amount: expectedAmount })` using the amount stored at topup-init (never `verify.amount ?? 0`, which silently zero-credits on malformed responses — `wallet.service.ts:117`). Add a `WalletEngine`-contract test where a strict mock throws `UNSUPPORTED_OPERATION` for query — the local adapter's leniency currently hides this.

### 2. No e2e coverage of the money loop, and CI would not catch it anyway
**Evidence:** e2e suites skip unless `DATABASE_URL` is set; `wallets` e2e exists but needs Postgres; `apps/web/e2e` tests the UI without a real adapter; the ZarinPal↔wallet seam (finding #1) sits between them.
**Scenario:** #1 was written months ago, reviewed, merged, deployed — invisible the whole way down.
**Fix:** (a) contract tests driving a *strict mock* of `PaymentService` against every consumer (wallet, billing.web, renewal spec); (b) a `mock-zarinpal` docker profile in docker-compose so `smoke.deploy.sh` can walk request→requestPayment→sandbox-verify→credit on every release.

---

## SEV-1 — exploitable by a competent attacker

### 3. SSRF / arbitrary egress through the AI brain adapter
**Evidence:** `apps/api/src/modules/orchestrator/config-hub.service.ts:255` — the service `fetch()`es `${brain.baseUrl}/v1/models` where `brain.baseUrl` is stored configuration written by the dashboard owner. The same service returns config to cloud brains for chat rerouting (`brain-route.service.ts` → external `baseUrl`).
**Scenario:** Any account holding OWNER role (phished OTP session, SIM-swapped phone — see #6) sets `baseUrl` to `http://169.254.169.254/latest/` or an internal host; the platform happily fetches it server-side. Cloud-brain chats then stream office privileged context to the attacker URL. Severity is moderated by (a) only OWNER/STAFF can write cloud config, (b) outbound fetch response isn't reflected to the caller — but chat *responses* are streamed back, so the exfil channel is real and rich.
**Fix:** (1) scheme allowlist (https only in prod); (2) private/loopback IP block on resolution (dns + connect); (3) an **AI egress allowlist** (`AI_EGRESS_ALLOW=openrouter.ai,api.openai.com`) evaluated at every brain fetch regardless of role; (4) the workspace guardians don't scan this — add a `brain.egress-inventory` check.

### 4. SSE access token rides in the URL
**Evidence:** `apps/web/src/app/stream/events/route.ts` — the Next proxy accepts `?token=` and forwards it; ADR-014 documents this as a tradeoff.
**Scenario:** JWTs (60-min access tokens binding sessionId + roles) land in reverse-proxy access logs, browser history, `Referer` if any asset leaks, analytics traces. One shared-office router log harvest = sessions for every user that ever opened a realtime stream.
**Fix:** (a) one-time stream tickets: POST `/stream/ticket` (Bearer auth) → single-use 30-sec ticket; event source uses `?ticket=`; (b) or `EventSource` polyfill w/ Authorization header (fetch-based SSE). Telemetry middleware must redact the query string regardless.

### 5. Wallet is a JSON blob under an in-process lock — honest as a prototype, dangerous as money
**Evidence:** `apps/api/src/modules/billing/wallet.service.ts` — balance = `WalletState` JSON per user via `StorageProvider`; serialization via per-user in-memory promise chain (`exclusive()`); credit path trusts provider amounts.
**Scenario:** (a) Two API replicas (any real deployment behind TLS+L7) race the same user's sessions → lost-update double-spend; no balance can go negative *in code*, but **spend-then-topup** interleavings on two processes can each read the pre-credit state. (b) A crash mid-write corrupts `wallets/<id>.json` (no WAL) — every wallet read fails-closed → that user's billing is bricked until manual repair.
**Fix:** Postgres table with `SELECT … FOR UPDATE` semantics and append-only ledger (P9 watermark direction was right); refuse to start without DATABASE_URL when PAYMENT_ADAPTER≠local (preflight already covers a billing row for local-only; extend to a start-fail rule). Until then: document loudly — **single-replica only** — and put the watermark checksum on every entry, not just the summary.

### 6. Single-authentication-factor account, channel = one SIM
**Evidence:** email OTP is intentionally deferred (ROADMAP P8 debt); passkeys exist as a UI surface after OTP; area-lock protects *areas*, not the account boundary.
**Scenario:** SIM-port attack ⇒ full OWNER takeover ⇒ rename brains to attacker infrastructure (#3) ⇒ pull `ops/backup` ("LAWYER_OWNER only") ⇒ entire office corpus exported. Everything after auth is strong; the *front door* is one text message.
**Fix:** land the email factor (queued) *and* make passkeys the primary boundary once attested; high-impact verbs (`ops/backup`, `security.rotate-secrets`, brain egress config, secrets mint) should require a **recent** auth (step-up: re-verify OTP ≤10 min or passkey) — the `auth.stepup` machinery can ride the existing tickets.

---

## SEV-2 — sharp edges that will cost nights

7. **`scryptSync` on the request thread.** `authvault/area-lock.service.ts:85` — default params, synchronous; unlock attempts consume the event loop. Mitigated by rate limit + min password, but N=16384 default is weak *and* slow simultaneously; calibrate explicitly (`N=2^15..2^17`, measure <150ms), run in worker thread, and protect the Sealed Areas unlock endpoints with a dedicated strict limiter (one pool hit per password guess is ~50ms of CPU — cheap to weaponize).

8. **Supply chain: 12 vulnerabilities (6 high) on `npm audit --omit=dev`** — incl. `qs` DoS advisories reaching through body-parser/express. `npm audit fix` is available. Do not ship the field trial carrying six HIGH advisories a scanner will list on day one.

9. **Audit metadata stores OTP destinations** (9 dense references to destination-in-metadata in `auth.service.ts`). This turns the audit trail into a PII honeypot; mask (`+9891…78`) at write time. The audit entity is otherwise tenant-scoped and accessible cross-tenant "by design" for admins — keep the boundary, drop the payload.

10. **Cloud AI consent is coarse.** Upload has a `sensitivity` param; `file-intelligence.service.ts` extracts previews, and corpus shelving flows onward — but there is no enforced "privileged files never leave the box" boundary when an office enables a cloud brain. Worst case: privileged legal text → external endpoint, sanctioned by nothing but the default routing profile. Fix: per-file `egressPolicy: local-only` (default privileged ⇒ local-only, enforced in the brain-route layer, override requires step-up + audit).

11. **Prompt-injection / corpus poisoning is unmitigated by design.** Files flow into context; a poisoned brief can steer answers across sessions. KBD for the demo, but the user-facing surfaces should label external-content provenance, and "critical ask" actions (timetables alerter, deep-sleep passes) should not auto-run over unquarantined intake text.

12. **Guardian standing snapshots are opt-off in production by default.** `SECURITY_SCAN_INTERVAL_MS=0` in dev is correct, but a SaaS-style scheduler (or a documented cron in `deploy/railway/FIELD_TRIAL_RUNBOOK.md`) should exist for VPS deploys; today an operator who forgets gets zero drifting detection. Also extend the sweep: open-port audit (`os` scanning) was killed from the deep scan — reintroduce as a read-only inventory against an allowlist, never with automatic kills (the original `killThread` bug proves cure > disease).

13. **Deep-sleep / cron maintenance has no observed alerting.** A failed sweep dies into an in-memory watch history; nothing pages. `notify.alert` sent is audited but in the sandbox nobody receives it. For the field: webhook to a channel the team reads.

14. **Six-digit OTP, HMAC-sealed with the JWT secret.** Rotating JWT secrets kills in-flight OTPs (KBD and documented); but pepper separation would let secrets.rotate-* not burn users mid-login. Low impact; cheap fix; worth a follow-up.

15. **File-text length has a preview cap but the full text path (corpus shelve) is unbounded per-file.** A 10MB PDF of garbage inflates AI cost per workspace with little defense. Budget: alert-only (`AI_BUDGET_MONTHLY_MILLION_AUTH` alerts, does not hard-stop). Pick a policy: hard stop (safe) or auto-downgrade to local templates (cheap) — silence is the worst outcome.

16. **Local-storage source-of-fallback semantics.** `storage/local-storage.adapter.ts` anchors under an absolute state dir — verified — but `../` normalization relies on the root's path.join discipline; add an explicit `resolve().startsWith(root)` assertion on every local write; one traversal hole in a storage key (file names are partially user-derived: `file.originalname`) writes outside the sandbox.

---

## What survived the assault (keep — these are the moat)

- **Zero-visible-error stack:** both auth channels, health, root billboard, exception filter, 413/400 envelopes — verified live and in CI (50 suites/355 tests, 47 pytest).
- **Session discipline:** rotate-on-refresh with row lock + reuse→epoch revocation (`auth.service.ts:400-425`), per-request session check in `JwtAccessGuard`, `auth.logout-all` kills areas via epoch.
- **Rate limiting is fail-closed and self-auditing** — the workspace guardian live-tested it and POSTURE score honestly reads **5.7** with warnings visible (rate-limit out-of-bounds, dev placeholders, workers down) instead of hallucinating green.
- **Preflight + billboard:** a misconfigured org boots but shouts the truth; no silent health.
- **CORS is closed-by-default** (`setup.ts`), HSTS production-gated by ADR, payloads bounded and envelope-mapped.
- **Audit trail is rich in invariants** (every security event, secret rotation, brain ping, wallet op) — the *logging* instinct is right; it's the payloads that need masking (#9).
- **Sealed Areas epoch primitives** (server-side unlock tickets, verified-on-read) — a good design that mostly needs better cryptography parameters (#7) and an offline path.
- **A2A protocol + machine tokens:** signature binds scopes/expires; vocabulary-closed; guardian verified zero-bodies hygiene.

---

## Recommended kill-order for the field trial

| # | Item | Effort |
|---|------|--------|
| 1 | ZarinPal↔wallet confirm path (#1) + strict-mock contract tests (#2a) | S |
| 2 | AI egress allowlist + private-IP block (#3) | S |
| 3 | SSE one-time tickets (#4) | S |
| 4 | `npm audit fix` (#8) | XS |
| 5 | Audit PII masking (#9) | XS |
| 6 | Wallet: Postgres ledger OR hard single-replica gate (#5) | M |
| 7 | Email factor + step-up for `ops/backup`, brain-config, secrets mint (#6) | M |
| 8 | per-file egress policy for privileged docs (#10) | S |
| 9 | Storage `resolve().startsWith(root)` assert (#16) | XS |
| 10 | Area-lock KDF calibration + worker thread (#7) | S |

Items 1–5 fit in one focused day and close every field-blocking gap. 6–10 are the follow-through that turn "field demo" into "trustworthy footing".
