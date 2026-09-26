# Roadmap

This roadmap describes intended direction, not commitments or dates. Suggestions are welcome in the issue tracker.

## Released: 1.0.0

- Office dashboard and client portal (PWA), Persian by default with English.
- SMS sign-in, passkeys, role-based access, area passwords and audit log.
- Expert assistants for civil, criminal, family, registration and international law, grounded in a verified library with pgvector retrieval.
- Drafts with lawyer review, file analysis (PDF, Word, text) and RSA signatures.
- Phone consultation queue with wallet, Zarinpal top-ups and SMS notifications (Kavenegar, Ghasedak).
- One-command installer, backups, restore, diagnostics and optional monitoring.

## Next: 1.x

- **Field testing:** end-to-end tests with real SMS and payment accounts; Playwright tests for the dashboard and portal.
- **Official gazette connector:** a collector that proposes new laws and amendments from the official gazette for lawyer verification.
- **Relational storage:** move purchases, queue tickets, notifications, drafts and the corpus from the key-value store to the relational tables reserved in migrations 006 and 007.
- **Client AI features:** the reserved AI subscriptions for clients (catalog entries are hidden and purchases return `409` until then).
- **Call integration:** connect the consultation queue to a VoIP or PBX provider so calls can be placed from the dashboard.
- **OCR** for scanned documents.
- **S3-compatible storage** for uploads and backups.

## Later

- Additional payment gateways and SMS providers.
- Multi-office deployments with per-office branding.
- A voice assistant with local speech recognition and synthesis.
