# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x | Yes |

Security fixes are released for the latest minor version.

## Reporting a vulnerability

Please report vulnerabilities privately. Do not open a public issue.

- **Preferred:** [GitHub private vulnerability reporting](https://github.com/ansariaiadmin/legal-platform/security/advisories/new)
- **Alternative:** Telegram [@ansariaiadmin](https://t.me/ansariaiadmin)

Include a description of the issue and its impact, steps to reproduce, and the affected version or commit.

We aim to acknowledge reports within 3 working days and to agree on a fix and disclosure date with you. Reporters are credited in the release notes unless they prefer otherwise.

## Security model

- **Authentication:** one-time SMS codes (hashed with a per-installation pepper) and passkeys. Access tokens expire after 15 minutes; refresh tokens after 7 days and are rotated on every use. Reusing an old refresh token revokes the whole session.
- **Authorization:** role-based. Clients only reach `/api/client/*`; the dashboard requires the `lawyer_owner`, `staff` or `operator` role. Sensitive dashboard areas can additionally require their own password.
- **Data at rest:** provider keys and signature keys are encrypted with `ENCRYPTION_MASTER_KEY`. Signature private keys are also encrypted with the lawyer's password.
- **Payments:** the wallet is credited only after the gateway verifies the payment, for the amount recorded when the payment started, and never twice for the same payment.
- **HTTP:** security headers on every response, rate limiting, and a standard error format that does not leak stack traces.
- **Containers:** application images run as a non-root user.
- **Privacy:** data stays on the office's server unless a cloud AI provider is connected. Documents marked privileged are processed only by local models.

## Operator checklist

- Keep `.env` private (`chmod 600 .env`; the installer does this) and back it up securely. Losing `ENCRYPTION_MASTER_KEY` makes encrypted data unrecoverable.
- Serve the platform over HTTPS in production; see `docs/SECURITY-HARDENING.md`.
- Expose only the web gateway. PostgreSQL, Redis and the monitoring tools must not be reachable from the internet.
- Configure real SMS and payment providers before going live; the `mock` providers are for development only.
- Encrypt off-site backups (`scripts/backup-prod.sh --encrypt`) and test restores regularly (`scripts/restore.sh --test`).
- Keep the host, Docker and the platform up to date.
