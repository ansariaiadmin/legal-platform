"""Queue worker — listens on the Redis queue fed by the NestJS orchestrator
(P2) and performs deterministic document-processing tasks.

Payload contract (JSON): {"jobId": str, "tool": str, "input": {<tool args>}}
Result posted back to `legal:workers:result:<jobId>` with a TTL (orchestrator
GETs it). Every reply carries `ok` + `tool` + `workerVersion` so the Leader can
show worker provenance on the dashboard.
"""
from __future__ import annotations

import base64
import json
import os
import time
import uuid
import traceback

from . import QUEUE_KEY, RESULT_PREFIX, __version__
from . import persian_tools as tools
from . import file_extract
from . import model_client
from .resp_client import RespClient, RespError

REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379")
RESULT_TTL_S = 3600


def _ask_model(text: str, *, system: str = "", max_tokens: str = "800", **_: object) -> dict:
    """Worker-side LLM call. The WORKER never decides where its brain lives —
    env/config does (operator pin or Leader lend), exactly like the API and
    exactly like the TS router will decide for agents (ADR-004/011)."""
    cfg = model_client.config_from_env()
    if cfg is None:
        # Honest no-brain answer, not a fake success (SPEC §12).
        return {"answered": False, "reason": "no_model_configured"}
    messages = ([{"role": "system", "content": system}] if system else []) + [
        {"role": "user", "content": text}
    ]
    out = model_client.chat_completion(
        cfg, messages, max_tokens=int(max_tokens)
    )
    return {
        "answered": True,
        "text": out["text"],
        "model": out["model"],
        "target": out["target"],
        "usage": out["usage"],
    }


TOOLS = {
    "normalize_persian": lambda text, **k: {"normalized": tools.normalize_persian(text)},
    "chunk_legal_text": lambda text, **k: {
        "chunks": tools.chunk_legal_text(
            text,
            max_chars=int(k.get("max_chars", 1800)),
            overlap=int(k.get("overlap", 120)),
        )
    },
    "article_refs": lambda text, **k: {"refs": tools.article_refs(text)},
    "word_count": lambda text, **k: {"words": tools.word_count(text)},
    "ask_model": _ask_model,
    # file intelligence (P1e): bytes arrive base64-encoded in the payload
    "file_digest": lambda data_b64, filename="", **k: file_extract.file_digest(
        base64.b64decode(data_b64), filename
    ),
    "extract_any": lambda data_b64, filename="", **k: file_extract.extract_any(
        base64.b64decode(data_b64), filename
    ),
}


def handle(payload: dict) -> dict:
    """Pure handler — processed identically in tests and in prod loop."""
    job_id = payload.get("jobId") or f"py-{uuid.uuid4()}"
    tool_name = payload.get("tool")
    input_args = payload.get("input") or {}
    fn = TOOLS.get(tool_name)
    if fn is None:
        return {"jobId": job_id, "ok": False, "error": f"unknown tool: {tool_name}",
                "tool": tool_name, "workerVersion": __version__}
    try:
        out = fn(**input_args)
        return {"jobId": job_id, "ok": True, "tool": tool_name,
                "workerVersion": __version__, "output": out}
    except Exception as exc:  # isolated failure domain (SPEC §2)
        return {"jobId": job_id, "ok": False, "tool": tool_name,
                "workerVersion": __version__,
                "error": f"{type(exc).__name__}: {exc}",
                "trace": traceback.format_exc(limit=3)}


def run_forever(poll_timeout_s: int = 5, max_jobs: int | None = None) -> None:
    client = RespClient(REDIS_URL)
    print(f"[pylegal-worker] v{__version__} up — queue={QUEUE_KEY} redis={REDIS_URL}")
    jobs = 0
    while True:
        try:
            item = client.blpop(QUEUE_KEY, timeout_s=poll_timeout_s)
        except (RespError, OSError) as exc:
            print(f"[pylegal-worker] redis error: {exc}; sleeping 2s")
            time.sleep(2)
            continue
        if item is None:
            continue
        # BLPOP returns [key, payload]
        raw = item[1] if isinstance(item, list) and len(item) == 2 else None
        if raw is None:
            continue
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            print("[pylegal-worker] dropped malformed payload (not json)")
            continue
        result = handle(payload)
        try:
            client.set(RESULT_PREFIX + result["jobId"], json.dumps(result, ensure_ascii=False),
                       ex=RESULT_TTL_S)
        except (RespError, OSError) as exc:
            print(f"[pylegal-worker] failed to post result for {result['jobId']}: {exc}")
        jobs += 1
        if max_jobs is not None and jobs >= max_jobs:
            return


if __name__ == "__main__":
    run_forever()
