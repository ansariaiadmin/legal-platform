"""file_extract — read ANY upload honestly (stdlib only).

Formats:
- .txt / .md / .json — utf-8 read (with BOM tolerance)
- .docx — OOXML zip: word/document.xml → strip tags, keep paragraph breaks
- .pdf — minimal pure-python extractor: FlateDecode streams + Tj/TJ text ops.
  Scanned PDFs have no text layer; we say so (`needs_ocr: true`) rather than
  hallucinating content (SPEC §12: no fake success).
- unknown binary — SHA256 + size + honest `needs_manual_review`.

The orchestrator PRE-READS with file_digest so the Leader can talk about the
file before a full analysis cycle.
"""
from __future__ import annotations

import hashlib
import io
import re
import zipfile
import zlib
from xml.etree import ElementTree


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _decode_text(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "windows-1256", "iso-8859-6"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    # lossy but logged: we never drop silently
    return data.decode("utf-8", errors="replace")


def extract_txt(data: bytes) -> dict:
    text = _decode_text(data)
    return {"format": "text", "text": text, "chars": len(text)}


def extract_docx(data: bytes) -> dict:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            xml_bytes = z.read("word/document.xml")
    except (zipfile.BadZipFile, KeyError) as e:
        raise ValueError(f"not a valid docx package: {e}") from e
    root = ElementTree.fromstring(xml_bytes)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paras: list[str] = []
    for p in root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"):
        parts = [t.text or "" for t in p.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t")]
        line = "".join(parts).strip()
        if line:
            paras.append(line)
    text = "\n".join(paras)
    return {"format": "docx", "text": text, "chars": len(text), "ns": bool(ns)}


_TJ_OP = re.compile(rb"\(((?:[^()\\]|\\.)*)\)\s*Tj")
_TJ_ARR = re.compile(rb"\[(.*?)\]\s*TJ")


def _pdf_unescape(raw: bytes) -> str:
    out = []
    i = 0
    while i < len(raw):
        c = raw[i]
        if c == 0x5C and i + 1 < len(raw):  # backslash
            nxt = raw[i + 1]
            mapping = {0x6E: "\n", 0x72: "\r", 0x74: "\t", 0x28: "(", 0x29: ")", 0x5C: "\\"}
            if nxt in mapping:
                out.append(mapping[nxt])
                i += 2
                continue
        out.append(chr(c))
        i += 1
    return "".join(out)


def extract_pdf(data: bytes) -> dict:
    if not data.startswith(b"%PDF"):
        raise ValueError("missing %PDF header")
    chunks: list[str] = []
    # text lives in compressed content streams; find every stream..endstream
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", data, re.DOTALL):
        stream = m.group(1)
        try:
            stream = zlib.decompress(stream)
        except zlib.error:
            pass  # uncompressed or other filter — try as-is
        for t in _TJ_OP.findall(stream):
            chunks.append(_pdf_unescape(t))
        for arr in _TJ_ARR.findall(stream):
            parts = _TJ_OP.findall(arr)
            chunks.append("".join(_pdf_unescape(p) for p in parts))
    text = "".join(chunks).strip()
    if not text:
        # A scanned PDF yields NOTHING here by design — honest marker instead
        # of OCR-by-hallucination. Phase 4 may add a real OCR adapter.
        return {"format": "pdf", "text": "", "chars": 0, "needs_ocr": True}
    return {"format": "pdf", "text": text, "chars": len(text)}


MAGIC = [
    (b"%PDF", "pdf"),
    (b"PK\x03\x04", "docx-or-zip"),
]


def extract_any(data: bytes, filename: str = "") -> dict:
    name = (filename or "").lower()
    if data.startswith(b"%PDF"):
        return extract_pdf(data)
    if data.startswith(b"PK\x03\x04") and (name.endswith(".docx") or not name):
        try:
            return extract_docx(data)
        except ValueError:
            return {"format": "zip", "text": "", "chars": 0, "needs_manual_review": True}
    if name.endswith((".docx",)):
        # content sniff said zip but named docx without PK header — corrupt
        return {"format": "unknown", "text": "", "chars": 0, "needs_manual_review": True}
    # treat as text
    result = extract_txt(data)
    result["format"] = "text"
    return result


def file_digest(data: bytes, filename: str = "") -> dict:
    """Pre-read digest: the Leader's "I looked at it" card."""
    kind = "text"
    if data.startswith(b"%PDF"):
        kind = "pdf"
    elif data.startswith(b"PK\x03\x04"):
        kind = "docx" if filename.lower().endswith(".docx") else "zip"
    elif any(b > 0xF7 for b in data[:64]) or b"\x00" in data[:64]:
        kind = "binary"
    return {
        "sha256": sha256_hex(data),
        "bytes": len(data),
        "kindGuess": kind,
        "filename": filename,
    }
