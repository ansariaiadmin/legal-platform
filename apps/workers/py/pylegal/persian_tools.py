"""Persian text utilities used by collectors/normalizers (P2).

All functions are stdlib-only, dependency-free and deterministic so the same
document always yields the same normalized form — a hard requirement for
content hashing and deduplication (SPEC §9 provenance).
"""
from __future__ import annotations

import re
import unicodedata

# Arabic -> Persian character folding, the most common ingestion bug.
_AR_TO_FA = str.maketrans({
    "ي": "ی", "ك": "ک", "ة": "ه", "ۀ": "ه",
    "ؤ": "و", "أ": "ا", "إ": "ا", "ء": "",
    "٠": "۰", "١": "۱", "٢": "۲", "٣": "۳", "٤": "۴",
    "٥": "۵", "٦": "۶", "٧": "۷", "٨": "۸", "٩": "۹",
})

_WS_RE = re.compile(r"[ \t‌\u200c]+")
_SENTENCE_SPLIT = re.compile(r"(?<=[.!؟?؛:])\s+")


def normalize_persian(text: str) -> str:
    """Fold Arabic variants to Persian, fix ZWNJ spacing, trim blanks."""
    if not isinstance(text, str):
        raise TypeError("text must be str")
    text = unicodedata.normalize("NFC", text)
    text = text.translate(_AR_TO_FA)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # collapse runs of spaces/tabs but keep newlines (structure matters for
    # article/chunk boundaries in legal documents)
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.split("\n")]
    text = "\n".join(ln for ln in lines if ln != "")
    return text.strip()


def split_sentences(text: str) -> list[str]:
    """Sentence splitter that respects Persian punctuation."""
    text = normalize_persian(text)
    if not text:
        return []
    parts = _SENTENCE_SPLIT.split(text)
    return [p.strip() for p in parts if p.strip()]


def word_count(text: str) -> int:
    return len(re.findall(r"\S+", normalize_persian(text)))


def chunk_legal_text(text: str, *, max_chars: int = 1800, overlap: int = 120) -> list[str]:
    """Chunk by sentences with a sliding overlap — chunks must never split a
    ماده mid-way if avoidable, because retrieval quotes them."""
    if max_chars <= 0 or overlap < 0 or overlap >= max_chars:
        raise ValueError("bad chunking parameters")
    sentences = split_sentences(text)
    chunks: list[str] = []
    buf: list[str] = []
    size = 0
    for s in sentences:
        if size + len(s) > max_chars and buf:
            chunks.append(" ".join(buf))
            # carry the tail sentence(s) that fit into the overlap budget
            keep: list[str] = []
            keep_size = 0
            for back in reversed(buf):
                if keep_size + len(back) > overlap:
                    break
                keep.insert(0, back)
                keep_size += len(back)
            buf = keep
            size = keep_size
        buf.append(s)
        size += len(s)
    if buf:
        chunks.append(" ".join(buf))
    return chunks


def article_refs(text: str) -> list[dict[str, str]]:
    """Extract references like «ماده ۱۰ قانون مدنی» / «تبصره ۲» for
    citation indexing (Phase 2+ wiring into citation_links)."""
    pattern = re.compile(r"(ماده|تبصره|بند|اصل)\s+([۰-۹0-9]+)(?:\s+(قانون\s+[^\s.،؛]+))?")
    refs = []
    for m in pattern.finditer(normalize_persian(text)):
        refs.append({
            "kind": m.group(1),
            "number": m.group(2),
            "law": (m.group(3) or "").strip(),
        })
    return refs
