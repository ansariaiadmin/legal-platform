"""pylegal — Python sidecar workers for the Legal OS agent fleet (SPEC §11a).

Design rules:
- stdlib only. No pip, no network calls except Redis (RESP over socket) and
  HTTP fetches performed by collectors with explicit operator-approved URLs.
- Every function is pure and deterministic; the NestJS orchestrator treats
  these workers as a *toolbox*, never as decision makers. Routing/governance
  stays with the Leader (ADR-004/005).
"""

__version__ = "0.1.0"

QUEUE_KEY = "legal:workers:queue"
RESULT_PREFIX = "legal:workers:result:"
