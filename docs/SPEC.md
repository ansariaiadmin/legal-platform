# LEGAL PLATFORM - AUTHORITATIVE SPEC (v1)
This file is the single source of truth for this repository.

## 1. Product
Self-hosted, single-tenant legal practice platform for Iranian lawyers.
One deployment = one lawyer or one office. White-label.
End-user UI in Persian via i18n keys; ALL internals (code, docs, schema,
API fields, logs, comments) in English.
Modules: public website + CMS, consultation booking, CRM/contact timeline,
wallet and payments, notifications, AI workspace (RAG + drafts), law update
monitor, provider settings, diagnostics, backup/restore, audit logs.
Tiers as feature flags: Basic / Pro / Smart AI.
Roles: lawyer_owner, staff, client, operator (setup only).
Non-goals: multi-tenant SaaS control plane, autonomous legal advice,
Windows desktop installer, internal PBX replacement.

## 2. Stack and Architecture
Modular monolith. NestJS API + Next.js App Router web + PostgreSQL 16 with
pgvector + Redis (cache/queue). Background workers inside same codebase.
Docker Compose deployment. Services: reverse proxy, web, api, worker,
postgres, redis.
Module boundaries: identity, website, cms, booking, crm, wallet, payments,
notifications, ai, law-monitor, providers, files, diagnostics, ops, audit.
Sync calls via typed application services; async via Redis-backed queues;
past-tense domain events for side effects.
Vertical scaling first; worker concurrency configurable.
Failure domains: provider/AI/telephony/ingestion outages must never crash
the platform or block unrelated features.

## 3. Deployment and Ops
Single deployment target: Linux VPS (Ubuntu 22.04+), min 4GB RAM (8GB with
AI), 40GB SSD, public IPv4, domain with automatic TLS.
One-command managed installer: scripts/install.sh.
Idempotent Linux-only ops scripts: install.sh start.sh stop.sh update.sh
backup.sh restore.sh diagnostics.sh. No Windows scripts.
Backups: db dump + file bundle + checksums; optional S3-compatible offsite;
provider credentials EXCLUDED from backups; restore requires explicit
confirmation and writes an audit entry.
Zero-support design: descriptive errors, guided wizards, self-serve
diagnostics and backup/restore.

## 4. Repository Structure
legal-platform/
  apps/web/src/{app,components,features,i18n,lib,styles} apps/web/public
  apps/api/src/{main.ts,app.module.ts,common,config,database,modules,providers,jobs,security}
  apps/api/test
  packages/{domain,contracts,shared}/src
  infra/{docker,nginx,postgres,redis}
  scripts/ docs/
  docker-compose.yml docker-compose.prod.yml .env.example README.md
Backend module layout: modules/<module>/{module.module.ts,module.controller.ts,
module.service.ts,module.repository.ts,dto/,entities/,policies/,tests/}
Provider layout: providers/{sms,payment,push,telephony,ai}/ with interface +
adapters (mock + real).
Frontend feature layout: features/<feature>/{components,hooks,actions,schemas,
pages,translations}.
Naming: files kebab-case; classes PascalCase; functions/vars camelCase;
DB snake_case; API fields camelCase; i18n keys dot.notation.
Forbidden: business logic in UI components; provider SDK calls in
controllers; DB access from frontend; duplicated domain enums.

## 5. Database Standards
PostgreSQL 16+, UTF-8, UUID PKs, created_at/updated_at on mutable entities,
explicit foreign keys, snake_case.
Append-only and immutable: ledger_entries, audit_logs.
Core tables:
 identity: users, user_sessions, otp_challenges, roles, role_assignments
 website/cms: site_configs, pages, posts, media_assets, navigation_menus, seo_profiles
 booking: consultation_plans, availability_rules, booking_slots, bookings, booking_reminders
 crm: contacts, leads, inquiries, contact_timeline_events, call_logs
 finance: wallets, ledger_entries, payment_intents, payment_transactions, refunds, ai_credit_accounts, usage_records
 ai/corpus: knowledge_sources, ingestion_jobs, legal_documents, document_chunks, citation_links, retrieval_sessions, retrieval_results, draft_requests, draft_artifacts, review_decisions
 ops: provider_configs, backup_jobs, restore_jobs, diagnostic_runs, audit_logs, system_notices, license_records, data_export_requests, data_erasure_requests
High-growth tables must be designed partition-ready from day one:
audit_logs, usage_records, contact_timeline_events.
Provider secrets encrypted at rest. Embedding dimension configurable per
provider; never assume 1536; dimension change must be migratable.
Indexing: unique on normalized phone; GIN on filtered JSONB; vector index;
composite for timeline and booking calendar; partial for active records.

## 6. Domain Rules and State Machines
A booking maps to exactly one consultation plan.
A payment intent may receive 0..n callbacks but reaches exactly one terminal
state; duplicate callbacks handled idempotently; failed payment never
creates a wallet credit.
Ledger entries immutable after posting; balances derived, never stored.
AI credit consumption recorded independently from payment records.
A draft artifact can never be published without explicit human approval.
Legal documents keep source URL, fetch timestamp, and retrieval provenance.
Provider configuration changes are audited.
State machines:
 Booking: pending -> reserved -> paid -> confirmed -> completed | canceled | no_show
 PaymentIntent: created -> pending_gateway -> paid | failed | expired | refunded
 IngestionJob: queued -> running -> completed | failed | partial_success
 DraftRequest: created -> retrieving -> generating -> awaiting_review -> approved | rejected | superseded
 BackupJob: queued -> running -> completed | failed | expired

## 7. API Standards
REST + OpenAPI. Groups: /api/public/*, /api/dashboard/*, /api/webhooks/*.
Structured error payloads; audit logs on mutating endpoints; webhook
callbacks verified; idempotency keys required for payment-intent creation.
Auth: OTP for clients; access+refresh tokens for dashboard.
Public: GET site, pages/:slug, posts, posts/:slug; POST inquiries, bookings,
payments/intents, auth/otp/request, auth/otp/verify.
Dashboard: me, site-config, CRUD pages/posts/menus/plans, booking calendar,
CRM, wallet/ledger reads, provider config+health+test+fallback, diagnostics,
backup/restore, ai search/drafts/review/usage/routing/budget, law monitor queue.
Webhooks: payment/:provider, sms/:provider, telephony/:provider.

## 8. Providers
Interfaces: SmsProvider, PaymentProvider, AIProvider, TelephonyProvider,
StorageProvider, PushProvider. All access through adapters only.
Encrypted secret storage; health-checkable; Test-Connection before save;
credentials never returned in plain text; provider audit trail.
UI auto-disables features when provider missing/failing; automatic feature
discovery when healthy; configurable fallback per category.
Normalized provider exceptions; retries only where idempotent.
AI routing modes (operator chooses in wizard):
 iranian_gateway (default; Iran-accessible aggregator; configurable base_url)
 foreign_vps (operator's own out-of-country endpoint)
 custom_proxy (operator-supplied base_url)
No built-in sanctions circumvention. Embedding + generation via same adapter.
Payment adapters expose an idempotency capability flag; when the gateway is
not natively idempotent the adapter de-duplicates callbacks.

## 9. AI Rules
Layered AI: deterministic automation first; LLM only for high-value tasks.
RAG: ingest official source -> normalize -> chunk -> embed -> index in
pgvector -> retrieve -> rerank -> generate draft WITH citations -> lawyer
review required.
Source trust tiers: 1 official only; 2 lawyer-approved commentary;
3 general references, disabled by default. Each source tracks a
quality/health score; sync failures surface in diagnostics with retry and
manual injection.
Never present output as final legal advice; provenance preserved; provider
and model logged per draft.
Cost controls: token/request metering, per-feature quotas, monthly budget
with alerts, premium disabled at budget exhaustion unless overridden.

## 10. Security
Secure by default. OTP rate limiting, challenge expiry, brute-force
protection, session invalidation. Least privilege; owner-only critical ops.
Audit at minimum: logins/logout/security changes, provider credential
changes, payment state changes, AI draft approval/rejection, backup/restore,
role changes, sensitive exports/erasure.
Secrets never logged. Structured JSON logs with requestId, actorId, module,
action, result.
Production rules: no default JWT secrets, no fake payment success, no
unencrypted provider credentials, TLS required, debug endpoints disabled.
Error code prefixes: AUTH_ VALIDATION_ PAYMENT_ PROVIDER_ AI_ DB_ BACKUP_
SECURITY_ SYSTEM_.
Client data export and erasure workflows with cooldown and audit trail.

## 11. Jobs and Events
Jobs: legal-source-sync daily; ai-draft-generation queue; sms-dispatch queue;
payment-reconcile hourly; missed-call-followup queue; backup-create
scheduled/manual; health-snapshot every 5m; retry-failed-events every 1m.
Events past tense: LeadCreated, ClientCreated, CaseOpened, PaymentConfirmed,
PaymentFailed, WalletCredited, SmsQueued, SmsDelivered, CallMissed,
AiDraftCreated, AiDraftApproved, BackupCompleted, BackupFailed.
Exponential backoff for transient provider failures; never blindly retry
non-idempotent payment confirmation; dead-letter after max retries.

## 12. Coding and Delivery Standards
Strict typing; dependency injection for providers; no global mutable state.
Every implementation batch MUST return this Output Contract:
## Implemented / ## Files Created/Changed / ## Commands To Run /
## Environment Variables Needed / ## Tests Added / ## Known Limitations /
## Next Safe Step
Validation before marking done: builds without type errors; migrations
deterministic; compose boots; health endpoint works; env vars documented;
phase tests pass; no secrets committed; no provider SDK bypass.
Allowed placeholders: mock adapters, demo seed, disabled flags, empty
credentials. FORBIDDEN: fake auth, fake payment success, fake encryption,
fake backup/migration/ingestion success.
