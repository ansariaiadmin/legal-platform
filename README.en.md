<p align="center">
  <img src="apps/web/public/icon.svg" width="96" alt="Legal Platform logo">
</p>

<h1 align="center">Legal Platform (پلتفرم حقوقی)</h1>

<p align="center">
  Open-source, self-hosted software for Iranian law offices<br>
  AI legal assistant · cited law library · queued phone consultations · client portal
</p>

<p align="center">
  <a href="https://github.com/ansariaiadmin/legal-platform/actions/workflows/ci.yml"><img src="https://github.com/ansariaiadmin/legal-platform/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <img src="https://img.shields.io/badge/version-1.0.0-1e40af" alt="Version 1.0.0">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue" alt="AGPL-3.0-or-later"></a>
  <img src="https://img.shields.io/badge/Node.js-22-339933?logo=node.js" alt="Node.js 22">
</p>

<p align="center"><a href="README.md">فارسی</a></p>

> **Disclaimer:** nothing this software produces is legal advice. Every answer and draft must be reviewed by a licensed lawyer before it is relied on.

## Overview

Legal Platform runs on the office's own server. Case and client data stay on that server unless you choose to connect a cloud AI provider. The product has two parts:

| Part | Path | Users |
|---|---|---|
| Office dashboard | `/` | Lawyers and office staff |
| Client portal | `/portal/` | Clients (installable on phones as a PWA) |

The interface is Persian (right-to-left) by default, with English available.

## Features

**Office dashboard**
- **Legal assistant:** chat with a lead assistant that routes each question to an expert assistant (civil, criminal, family, registration, international or general).
- **Legal library:** law texts enter the library only after verification, and answers cite verified sources only. Search combines full-text and vector search (pgvector).
- **Drafts:** cited drafts of pleadings and contracts, with a lawyer review and approval workflow.
- **Files:** upload and analyse office documents (PDF, Word and plain text).
- **Phone consultations:** 10, 20 and 30-minute plans, an open/close queue, and calling the next client.
- **Digital signatures:** RSA-2048 document signing and verification.
- **Security:** separate passwords for sensitive areas, passkey sign-in, audit log, daily security checks and backups.
- **Setup wizard:** guides the office through first-time setup after the first sign-in.

**Client portal**
- Sign in with an SMS code, top up the wallet through the payment gateway, buy a consultation and join the queue.
- Queue position and estimated wait; an SMS when the turn is approaching.

## Supported services

| Purpose | Supported services |
|---|---|
| AI | Any OpenAI-compatible API, cloud or local (for example Ollama) |
| SMS | Kavenegar, Ghasedak |
| Payment gateway | Zarinpal |
| Email | Any SMTP server |

In production, a feature whose service is not configured stays disabled; it never shows simulated results. The lawyer places consultation calls; automatic PBX integration is not implemented yet.

## Quick start

Requirements: Ubuntu 22.04 or later (or WSL2 on Windows), 4 GB RAM and 40 GB of free disk space.

```bash
git clone https://github.com/ansariaiadmin/legal-platform.git
cd legal-platform
sudo OWNER_PHONE=09120000000 ./setup.sh
```

The script installs Docker if needed, generates random secrets, starts the services and waits until they are healthy. Then open:

- Dashboard: `http://localhost:8080`
- Client portal: `http://localhost:8080/portal/`

Sign in with the `OWNER_PHONE` number. Until an SMS provider is configured, the owner's sign-in code is printed in the log:

```bash
docker compose logs api | grep OTP
```

Full guide, including domains, HTTPS, SMS and payment setup: [INSTALL.md](INSTALL.md)

## Development

```bash
npm ci
npm run build:packages
npm test          # tests for all workspaces
npm run lint      # un-awaited promise checks for the API
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Documentation

| Document | Topic |
|---|---|
| [INSTALL.md](INSTALL.md) | Installation, domain, HTTPS and service setup |
| [docs/USER_GUIDE_EN.md](docs/USER_GUIDE_EN.md) | User guide (English) |
| [docs/USER_GUIDE_FA.md](docs/USER_GUIDE_FA.md) | User guide (Persian) |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Operations and troubleshooting (Persian) |
| [docs/BACKUP.md](docs/BACKUP.md) | Backup and restore |
| [docs/API.md](docs/API.md) | API reference |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Architecture |
| [SECURITY.md](SECURITY.md) | Reporting vulnerabilities |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [ROADMAP.md](ROADMAP.md) | Roadmap |

## Supporting the project

Legal Platform is free and open source. If it is useful to you, you are welcome to donate any amount you like; the donation page will be linked here and in the application's About screen soon. Starring the repository, reporting bugs and recommending the project to colleagues also help.

## Services and custom work

Installation and support, automation projects and custom platform development:

- Telegram: [@ansariaiadmin](https://t.me/ansariaiadmin)
- Website: [ansariai.ir](https://ansariai.ir)

## License and attribution

Copyright © 2026 Mohammad Ansari. Licensed under the [GNU AGPL-3.0-or-later](LICENSE) with additional terms under section 7 ([NOTICE](NOTICE)):

- The attribution "Original work by Mohammad Ansari — https://ansariai.ir" must remain in the footer and About screen of every copy, including modified versions.
- Nobody may claim to be the original author. Modified versions must be clearly marked as modified and state that they are based on "Legal Platform by Mohammad Ansari".
- The project names and logo are not licensed ([TRADEMARKS.md](TRADEMARKS.md)).
- Anyone who offers a modified version to users over a network must make its source code available to those users (AGPL section 13).
