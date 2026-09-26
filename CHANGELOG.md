# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-09-26

First public release, under the name **پلتفرم حقوقی (Legal Platform)**, copyright Mohammad Ansari, licensed AGPL-3.0-or-later with additional attribution terms (see `NOTICE`).

### Added
- **Office dashboard** (Next.js 15): assistant chat, expert assistants, legal library, drafts, files, activity, phone consultations, AI model settings, security and an About screen with attribution and contact details. Persian (RTL) by default, English available.
- **Client portal** at `/portal/` (installable PWA): SMS sign-in, wallet top-up through the payment gateway, consultation purchase, queue position and notifications.
- **Setup wizard** that opens after the owner's first sign-in: office profile, AI model, consultation plans, first library source, first backup and security.
- **Owner bootstrap:** the phone number in `OWNER_PHONE` receives the `lawyer_owner` role on first sign-in. Until an SMS provider is configured, the owner's code is written to the API log.
- **Expert assistants** for civil, criminal, family, registration and international law, plus a general assistant; answers cite verified library sources only.
- **Retrieval** over the verified library with pgvector (`rag_chunks`, migration 010), with a file-based fallback index.
- **Server-held signature keys:** RSA-2048 keys encrypted with the lawyer's password.
- **Providers:** Ghasedak (API v1) and Kavenegar for SMS, Zarinpal for payments, OpenAI-compatible AI endpoints (cloud or local), SMTP email.
- **Operations:** `setup.sh`, `scripts/diagnostics.sh`, `scripts/logs.sh`, backup and restore scripts, production compose file with an optional monitoring profile, nginx gateway for the dashboard, portal and API.
- **Database options:** `DATABASE_SSL` / `?sslmode=require` for TLS, `DATABASE_POOL_MAX` for the pool size.
- ESLint flat config with type-aware promise rules (`npm run lint`), run in CI.
- Donation and attribution: `NOTICE` (AGPL section 7 terms), `TRADEMARKS.md`, `.github/FUNDING.yml`.

### Changed
- Every user-facing text rewritten in formal Persian and plain English; API error messages are formal Persian with stable error codes.
- Web and portal sessions renew access tokens automatically and sign out cleanly when a session is revoked.
- Wallet top-ups return to `/portal/?topup=return` and credit the wallet only after the gateway verifies the payment; confirming twice never credits twice.
- Purchases, queue tickets and notifications persist across restarts.
- A provider left as `mock` in production is reported as not configured instead of returning simulated results.
- AI subscriptions for clients are not sold yet: the catalog lists none and the purchase endpoint returns `409 SYSTEM_FEATURE_NOT_AVAILABLE`.
- Legal content of the expert assistants reviewed against current law, including the 1403 law on official registration of real-estate transactions and the 1403 industrial property law.
- Node.js 22 is required. `.env` is created with mode 600.

### Fixed
- Sign-in could deadlock the database pool when a new user was created; the transaction client is now released before audit logging.
- A database outage during sign-in returned `401`, which signed users out; it now returns `503 AUTH_DEPENDENCY_DOWN`.
- Client notifications were returned as an empty object because a promise was not awaited; marking notifications read is now awaited too.
- Unknown routes return `404 SYSTEM_ROUTE_NOT_FOUND` in the standard error format.
- The exception filter keeps the error code of HTTP exceptions that carry `{ code, message }`.
- The production compose file now includes the Python text-processing worker needed for PDF and Word extraction.
- The worker process exits with an error instead of hanging when it fails to start.

### Removed
- The `worker` container. It ran a second copy of the API without HTTP, duplicated the scheduled security scan and could overwrite shared state written by the API. Background work runs inside the API process; text processing runs in `workers-py`.
- Obsolete scripts, the root Dockerfile, placeholder setup assets and unused scaffolding.
