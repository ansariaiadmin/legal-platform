"""model_client — talk to ANY OpenAI-compatible model endpoint with stdlib only.

The whole قاعده: one API shape, many backends. The leader's cloud gateway
(AI_BASE_URL) and the on-prem box (AI_LOCAL_BASE_URL) both speak
`POST /v1/chat/completions`. The worker hits whichever URL it is told — the
orchestrator/lender chooses, this client just executes and reports faithfully.

Security: api keys travel ONLY in the Authorization header (never in URL,
never logged). Timeouts are mandatory. Retries are NOT automatic — callers
decide (idempotency rules, SPEC §8).
"""
from __future__ import annotations

import json
import os
import urllib.request
import urllib.error
from dataclasses import dataclass


@dataclass
class ModelConfig:
    base_url: str          # e.g. http://gpu-box:11434/v1 or https://gw.example/v1
    api_key: str           # may be "" for unauthenticated local boxes
    model: str             # concrete model id
    timeout_s: float = 30.0
    target: str = "cloud"  # informational: 'local' | 'cloud'


class ModelCallError(Exception):
    def __init__(self, message: str, *, status: int | None = None, retryable: bool = False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


def _endpoint(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + path


def chat_completion(cfg: ModelConfig, messages: list[dict[str, str]], *,
                    temperature: float = 0.2, max_tokens: int = 800) -> dict:
    """Minimal OpenAI-compatible chat call. Returns the provider's message
    plus usage verbatim — NEVER invented on failure."""
    payload = {
        "model": cfg.model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    req = urllib.request.Request(
        _endpoint(cfg.base_url, "/v1/chat/completions"),
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {cfg.api_key}"} if cfg.api_key else {}),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=cfg.timeout_s) as res:
            body = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        retryable = e.code in (429, 500, 502, 503, 504)
        raise ModelCallError(f"model HTTP {e.code}", status=e.code, retryable=retryable) from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise ModelCallError(f"model unreachable: {e}", status=None, retryable=True) from e

    choices = body.get("choices") or []
    if not choices:
        raise ModelCallError("empty choices from model", status=200, retryable=False)
    return {
        "text": choices[0].get("message", {}).get("content", ""),
        "model": body.get("model", cfg.model),
        "usage": body.get("usage"),
        "target": cfg.target,
    }


def config_from_env(*, prefer_local: bool = True) -> ModelConfig | None:
    """Resolve the model endpoint for a worker. Workers don't get to choose
    THEIR brain; the operator (or Leader-lend) does — env only, no secrets in
    code (SPEC §8)."""
    local_url = os.environ.get("PYLEGAL_LOCAL_MODEL_URL", "")
    local_model = os.environ.get("PYLEGAL_LOCAL_MODEL", "")
    cloud_url = os.environ.get("PYLEGAL_CLOUD_MODEL_URL", "")
    cloud_model = os.environ.get("PYLEGAL_CLOUD_MODEL", "")
    cloud_key = os.environ.get("PYLEGAL_CLOUD_MODEL_KEY", "")
    if prefer_local and local_url and local_model:
        return ModelConfig(base_url=local_url, api_key="", model=local_model, target="local")
    if cloud_url and cloud_model:
        return ModelConfig(base_url=cloud_url, api_key=cloud_key, model=cloud_model, target="cloud")
    return None
