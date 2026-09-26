# Contributing

Thank you for helping improve Legal Platform (پلتفرم حقوقی). This guide explains how to set up the project, what we expect from a change, and how contributions are licensed.

## Before you start

- For bugs, open an issue with steps to reproduce, the expected result and the actual result. Include the output of `./scripts/diagnostics.sh` when the problem is operational.
- For larger changes, open an issue first so the approach can be agreed before you invest time.
- Security problems must **not** be reported in public issues. See [SECURITY.md](SECURITY.md).

## Development setup

Requirements: Node.js 22, npm 10, Python 3.11 (for the text-processing worker), and Docker if you want to run the full stack.

```bash
git clone https://github.com/ansariaiadmin/legal-platform.git
cd legal-platform
npm ci
npm run build:packages
```

Run the full stack locally:

```bash
cp .env.example .env        # then fill in the secrets, see INSTALL.md
docker compose up -d --build
```

The dashboard is served at `http://localhost:8080` and the client portal at `http://localhost:8080/portal/`.

## Repository layout

| Path | Contents |
|---|---|
| `apps/api` | NestJS 11 API, database migrations and API tests |
| `apps/web` | Office dashboard (Next.js 15) |
| `apps/client` | Client portal (Next.js 15, served under `/portal`) |
| `apps/agents/*` | Expert assistants (civil, criminal, family, registration, international, general) |
| `apps/workers/py` | Python text-processing worker (standard library only) |
| `packages/domain`, `packages/contracts`, `packages/shared` | Shared types, error codes and agent kit |
| `infra/` | Dockerfiles and nginx configuration |
| `scripts/` | Installation, backup, restore and diagnostics scripts |

## Checks

Run these before opening a pull request. CI runs the same steps.

```bash
npm run typecheck
npm run lint
npm test
npm run test:py
npm run security:secrets
```

## Guidelines

- **Tests:** every bug fix and feature needs a test. Tests must not depend on timing (use `queue.settled()` rather than sleeps) or on external services.
- **Types:** avoid `any`; use precise types or `unknown` with narrowing.
- **Promises:** never leave a promise un-awaited; `npm run lint` enforces this for the API.
- **Errors:** return a code from `packages/contracts` (`ERROR_CODES`) with a formal Persian message. New codes need a known prefix and an HTTP status in `httpStatusForCode`.
- **Texts:** user-facing Persian is formal and uses the Persian half-space (ZWNJ) correctly. Update both the Persian and English strings in `apps/web/src/i18n`.
- **Legal content:** cite the exact article and law, and verify it is in force. Do not hard-code fines or prices that change by regulation.
- **Secrets:** never commit secrets or real personal data. `.env` is ignored by Git.
- **Migrations:** add a new numbered migration; never edit one that has been released. See `apps/api/src/database/MIGRATIONS.md`.
- **Commits:** write clear, imperative commit messages (for example "Fix wallet top-up confirmation").

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change with tests and documentation.
3. Make sure all checks pass.
4. Open a pull request that explains what changed and why, and fill in the template.

## License of contributions

The project is licensed under the [GNU AGPL-3.0-or-later](LICENSE) with the additional terms in [NOTICE](NOTICE). By submitting a contribution you agree that it is licensed under the same terms (inbound = outbound), and you confirm that you have the right to submit it.

## Contact

- Issues: https://github.com/ansariaiadmin/legal-platform/issues
- Telegram: [@ansariaiadmin](https://t.me/ansariaiadmin)
