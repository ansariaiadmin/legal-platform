"""local_answer — intelligence that survives total cloud loss (P6-S4).

قاعده کاربر: «کلاد نیست، هوشمندی باید بماند». No model at all here — a stdlib
BM25-lite extractive engine: rank passage sentences against the question,
return VERBATIM spans with scores. The output contract carries the honest
`engine: 'local_rules_extractive'` marker so the API layer can mark the
answer degraded (advisory placement per SPEC §9 — never passes extractive
spans off as composed legal advice).

Design notes:
- Tokenizer handles Persian: splits on non-alphanumeric, keeps فarsi letters.
- BM25 constants: k1=1.5, b=0.75 (standard defaults).
- Deterministic: no randomness, no time, no environment lookups.
"""
from __future__ import annotations

import math
import re

_TOKEN = re.compile(r"[\wآ-یٔ]+", re.UNICODE)

_K1 = 1.5
_B = 0.75


def _tokens(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN.findall(text)]


def _sentences(text: str) -> list[str]:
    # Legal Farsi separates sentences with '.' or newline; '؛' is intra-clause.
    parts = re.split(r"[.\n]+", text)
    return [p.strip() for p in parts if len(p.strip()) > 3]


def score_sentences(question: str, passages: list[str]) -> list[dict]:
    """BM25-lite over (passage, sentence) units. Returns best→worst with
    source passage indexes so the API can build real citations."""
    units: list[tuple[int, str, list[str]]] = []
    for p_idx, passage in enumerate(passages):
        for sent in _sentences(passage):
            toks = _tokens(sent)
            if toks:
                units.append((p_idx, sent, toks))
    if not units:
        return []

    q_toks = set(_tokens(question))
    if not q_toks:
        return []

    avgdl = sum(len(u[2]) for u in units) / len(units)
    # document frequency
    df: dict[str, int] = {}
    for _, _, toks in units:
        for t in set(toks):
            df[t] = df.get(t, 0) + 1

    n = len(units)
    scored: list[dict] = []
    for p_idx, sent, toks in units:
        tf: dict[str, int] = {}
        for t in toks:
            if t in q_toks:
                tf[t] = tf.get(t, 0) + 1
        if not tf:
            continue
        score = 0.0
        for t, f in tf.items():
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            score += idf * (f * (_K1 + 1)) / (f + _K1 * (1 - _B + _B * len(toks) / avgdl))
        scored.append({"passageIndex": p_idx, "sentence": sent, "score": round(score, 4)})
    scored.sort(key=lambda r: r["score"], reverse=True)
    return scored


def local_answer(question: str, passages: list[str], top_k: str | int = 3, **_ignored: object) -> dict:
    """Tool entry: extract the best verbatim spans. `answered:false` when
    nothing clears the bar — honesty over fluency (the cloud would have
    hallucinated something charming here)."""
    if not passages:
        return {"answered": False, "reason": "no_passages", "engine": "local_rules_extractive"}
    ranked = score_sentences(question, passages)
    k = int(top_k)
    top = [r for r in ranked if r["score"] > 0][:k]
    if not top:
        return {"answered": False, "reason": "zero_overlap", "engine": "local_rules_extractive"}
    return {
        "answered": True,
        "engine": "local_rules_extractive",
        "spans": top,
        "coverage": round(len({r["passageIndex"] for r in top}) / max(1, len(passages)), 4),
    }
