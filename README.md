# Legal Platform

Self-hosted, single-tenant legal practice platform for Iranian lawyers.

## Quickstart

```bash
# Copy environment template and configure
cp .env.example .env

# Start all services
docker compose up --build

# Open in browser
open http://localhost:8080
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| proxy (nginx) | 8080 | Reverse proxy, TLS termination |
| web (Next.js) | 3000 | Frontend application |
| api (NestJS) | 3001 | REST API server |
| worker | - | Background job processor |
| postgres | 5432 | PostgreSQL 16 with pgvector |
| redis | 6379 | Cache and message queue |

## Workspace Layout

```
legal-platform/
├── apps/
│   ├── api/              # NestJS backend
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       ├── config/
│   │       ├── modules/
│   │       ├── providers/
│   │       └── worker.ts
│   └── web/              # Next.js frontend
│       └── src/
│           ├── app/
│           ├── components/
│           ├── features/
│           └── i18n/
├── packages/
│   ├── domain/           # Domain enums and types
│   ├── contracts/        # API contracts and error codes
│   └── shared/           # Shared utilities
├── infra/
│   ├── docker/           # Dockerfiles
│   ├── nginx/            # Nginx configuration
│   ├── postgres/
│   └── redis/
├── scripts/
│   ├── install.sh        # One-command installer
│   ├── start.sh
│   ├── stop.sh
│   ├── backup.sh
│   ├── restore.sh
│   ├── update.sh
│   └── diagnostics.sh
├── docs/
│   └── SPEC.md           # Authoritative specification
├── docker-compose.yml
├── docker-compose.prod.yml
└── .env.example
```

## Requirements

- Ubuntu 22.04+ (for production deployment)
- Docker + Docker Compose plugin
- Minimum 4GB RAM (8GB with AI features)
- 40GB free disk space

## Documentation

See [docs/SPEC.md](docs/SPEC.md) for the complete authoritative specification.