# Roadmap — legal-platform

## Done (v1.0.0)

- [x] Orchestrator: deterministic routing, hybrid inference, intent classifier, fleet routing, config hub, evolution, governance + voice
- [x] Legal experts: civil/criminal/family/base, corpus grounding, collector worker, budget hard-stop
- [x] Security: JWT, roles guard, rate-limit, egress, stream ticket, phone normalization
- [x] Ops: backup/restore parsers, installer one-click, docker prod, storage, diagnostics, migrations
- [x] Billing: wallet, topup contract, payment contracts
- [x] Providers: tenant-scoped storage, factory, contracts
- [x] Tests: 67 suites 476 passed, 0 failed, jest open handles fixed
- [x] CI: lint + typecheck + jest + build
- [x] Docs: README badge+mermaid+quickstart, AGENTS, HANDOFF

## v2 (Explicit, Honest — No Hidden Gaps)

### Why v2?
- **OCR/Translation/Layout/Golden**: Currently legal RAG uses text extraction + embeddings. v2 will add OCR (tesseract/paddle) for scanned legal docs, translation (MarianMT/NLLB) for multilingual, layout rebuild (layout-parser) for tables/figures, golden benchmarks per Society. Reason: needs ML models + GPU + curated dataset.
- **Static Files Prod**: Currently local storage driver. v2: S3/minio prod driver with CDN. Reason: needs S3 infra.
- **Jinja2 Cache Docker Clean**: Currently Next.js cache. v2: Jinja2 cache for legal templates (if Python service added). Reason: currently Node-only, Python template service v2.
- **Real LLM Gateway**: Currently mock + local + cloud routing. v2: real Iranian gateway + cloud fallback with cost tracking. Reason: needs API keys + gateway infra.
- **Voice Pipeline**: Currently governance + voice spec. v2: full STT→LLM→TTS pipeline. Reason: needs voice models.

### Next Steps
1. OCR multi-engine for scanned legal docs
2. Translation adapter for multilingual
3. Layout rebuild with tables
4. Golden benchmarks per Society
5. S3 prod storage driver
6. Real LLM gateway with cost tracking
7. Voice pipeline STT/TTS

## Honest Scope

- No hidden gaps: all v2 items require external infra or ML models
- Current MVP: local storage, text-only RAG, mock LLM routing, 476 tests green
