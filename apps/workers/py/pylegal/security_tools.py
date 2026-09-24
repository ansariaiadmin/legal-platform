"""security_tools — the worker's eyes for the Security Guardian (P6-S4).

Static, deterministic pattern scan. NO AI involved: regex rules written by a
human today run identically tomorrow — that IS the security property. Rules
flag insecure-construction patterns in TS/JS and Python sources; the caller
(API side) decides WHICH files to send; the worker never reads the disk
itself (least surprise + sandboxing-by-absence-of-ability).

Every rule carries a reference id so reports line up with the standards
catalog (OWASP/CWE), matching standards.ts on the API side.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict


@dataclass(frozen=True)
class Rule:
    rule_id: str
    pattern: re.Pattern[str]
    languages: tuple[str, ...]   # 'ts', 'js', 'py'
    severity: str                # critical | high | medium | low
    ref: str                     # standard reference
    message: str


_RULES: tuple[Rule, ...] = (
    Rule(
        "no-eval",
        re.compile(r"(?<![.\w])eval\s*\("),
        ("ts", "js", "py"),
        "high",
        "CWE-95",
        "dynamic eval — user-influenced input can become code",
    ),
    Rule(
        "no-new-function",
        re.compile(r"new\s+Function\s*\("),
        ("ts", "js"),
        "high",
        "CWE-95",
        "Function constructor is eval in disguise",
    ),
    Rule(
        "no-innerhtml-assign",
        re.compile(r"\.innerHTML\s*="),
        ("ts", "js"),
        "medium",
        "CWE-79",
        "innerHTML assignment — XSS vector; use textContent or a sanitizer",
    ),
    Rule(
        "no-disabled-tls",
        re.compile(r"rejectUnauthorized\s*:\s*false|verify\s*=\s*False|NODE_TLS_REJECT_UNAUTHORIZED"),
        ("ts", "js", "py"),
        "critical",
        "CWE-295",
        "TLS verification disabled — MITM window",
    ),
    Rule(
        "no-insecure-random-token",
        re.compile(r"Math\.random\(\)|random\.random\(\)"),
        ("ts", "js", "py"),
        "high",
        "CWE-338",
        "non-crypto RNG — forbidden for tokens/secrets (use crypto.randomUUID / secrets)",
    ),
    Rule(
        "no-jwt-decode-only",
        re.compile(r"jwt\.decode\s*\("),
        ("ts", "js", "py"),
        "high",
        "CWE-345",
        "jwt.decode does NOT verify the signature — verification required",
    ),
    Rule(
        "no-pickle-loads",
        re.compile(r"\bpickle\.loads?\s*\("),
        ("py",),
        "critical",
        "CWE-502",
        "pickle deserialization — arbitrary code execution on hostile input",
    ),
    Rule(
        "no-shell-true",
        re.compile(r"shell\s*=\s*True"),
        ("py",),
        "high",
        "CWE-78",
        "subprocess with shell=True — command injection surface",
    ),
    Rule(
        "no-yaml-unsafe-load",
        re.compile(r"yaml\.load\s*\((?![^)]*Loader\s*=\s*yaml\.SafeLoader)"),
        ("py",),
        "high",
        "CWE-502",
        "yaml.load without SafeLoader — code execution on hostile YAML",
    ),
    Rule(
        "no-hardcoded-secret-shape",
        re.compile(r"(?:password|secret|api[_-]?key)\s*[:=]\s*['\"](?!your_|change_me|\$\{)[A-Za-z0-9_\-]{8,}['\"]", re.IGNORECASE),
        ("ts", "js", "py"),
        "critical",
        "CWE-798",
        "literal that LOOKS like a hardcoded credential — move to env",
    ),
)


def _lang_of(filename: str) -> str:
    if filename.endswith((".ts", ".tsx")):
        return "ts"
    if filename.endswith((".js", ".jsx", ".mjs", ".cjs")):
        return "js"
    if filename.endswith(".py"):
        return "py"
    return "other"


def security_scan(files: list[dict], **_ignored: object) -> dict:
    """Scan caller-supplied files: [{path, content}] → findings.

    Output is honest by construction: line numbers are 1-based, evidence is
    the exact matched text, and paths are echoed verbatim (the API sends
    repo-relative paths already).
    """
    findings: list[dict] = []
    scanned = 0
    for f in files:
        path = str(f.get("path", ""))
        content = str(f.get("content", ""))
        lang = _lang_of(path)
        if lang == "other":
            continue
        scanned += 1
        for lineno, line in enumerate(content.splitlines(), start=1):
            for rule in _RULES:
                if lang not in rule.languages:
                    continue
                m = rule.pattern.search(line)
                if m:
                    findings.append({
                        "ruleId": rule.rule_id,
                        "severity": rule.severity,
                        "ref": rule.ref,
                        "path": path,
                        "line": lineno,
                        "evidence": m.group(0),
                        "message": rule.message,
                    })
    return {
        "scannedFiles": scanned,
        "skippedNonCode": len(files) - scanned,
        "rulesLoaded": len(_RULES),
        "findings": findings,
    }
