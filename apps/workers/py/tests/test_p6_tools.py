"""P6-S4 worker tools: ping / security_scan / local_answer."""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pylegal import worker, security_tools, local_answer


# ---------- ping ----------

def test_ping_reports_provenance():
    out = worker.handle({"jobId": "t1", "tool": "ping", "input": {}})
    assert out["ok"] is True
    body = out["output"]
    assert body["pong"] is True
    assert body["workerVersion"]
    assert body["uptimeS"] >= 0
    assert isinstance(body["modelConfigured"], bool)


# ---------- security_scan ----------

def test_scan_flags_eval_and_innerhtml():
    files = [
        {"path": "src/a.ts", "content": "const x = eval(userInput)\nel.innerHTML = msg\n"},
        {"path": "src/b.ts", "content": "const clean = JSON.parse(raw)\n"},
        {"path": "notes.md", "content": "eval(this is not code, skipped)\n"},
    ]
    out = security_tools.security_scan(files)
    assert out["scannedFiles"] == 2
    assert out["skippedNonCode"] == 1
    ids = [(f["ruleId"], f["line"]) for f in out["findings"]]
    assert ("no-eval", 1) in ids
    assert ("no-innerhtml-assign", 2) in ids
    # clean file produced nothing
    assert all(f["path"] != "src/b.ts" for f in out["findings"])


def test_scan_python_rules():
    files = [{"path": "w.py", "content": "import pickle\nx = pickle.loads(b)\nsubprocess.run(cmd, shell=True)\n"}]
    out = security_tools.security_scan(files)
    ids = {f["ruleId"] for f in out["findings"]}
    assert "no-pickle-loads" in ids
    assert "no-shell-true" in ids


def test_scan_disabled_tls_is_critical():
    out = security_tools.security_scan(
        [{"path": "c.ts", "content": "httpsAgent: new Agent({ rejectUnauthorized: false })"}]
    )
    crit = [f for f in out["findings"] if f["ruleId"] == "no-disabled-tls"]
    assert crit and crit[0]["severity"] == "critical"


def test_scan_handles_through_worker_dispatch():
    out = worker.handle({
        "jobId": "t2",
        "tool": "security_scan",
        "input": {"files": [{"path": "a.py", "content": "import yaml\nd = yaml.load(s)\n"}]},
    })
    assert out["ok"] is True
    assert any(f["ruleId"] == "no-yaml-unsafe-load" for f in out["output"]["findings"])


# ---------- local_answer ----------

PASSAGES = [
    "ماده ۱۰ قانون مدنی: قراردادهای خصوصی نسبت به طرفین لازم‌الاجراست. ماده ۱۱ جزئیات را بیان می‌کند.",
    "کارگر بر اساس قانون کار حق فسخ فوری در موارد خاص را دارد.",
]


def test_local_answer_extracts_verbatim():
    out = local_answer.local_answer("قرارداد خصوصی لازم‌الاجرا است؟", passages=PASSAGES)
    assert out["answered"] is True
    assert out["engine"] == "local_rules_extractive"
    first = out["spans"][0]
    # verbatim extraction: the span sentence must exist in the source passage
    assert first["sentence"] in PASSAGES[first["passageIndex"]]
    assert "ماده ۱۰" in first["sentence"] or "قرارداد" in first["sentence"]


def test_local_answer_honest_zero_overlap():
    out = local_answer.local_answer("سازه پرواز بالن", passages=PASSAGES)
    assert out["answered"] is False
    assert out["reason"] == "zero_overlap"


def test_local_answer_empty_passages():
    out = local_answer.local_answer("هر چیزی", passages=[])
    assert out["answered"] is False
    assert out["reason"] == "no_passages"


def test_local_answer_deterministic():
    a = local_answer.local_answer("حق فسخ کارگر", passages=PASSAGES)
    b = local_answer.local_answer("حق فسخ کارگر", passages=PASSAGES)
    assert a == b


class TestLocalAnswerV2(P9T5 := type('ns', (), {})):  # noqa: N801 — simple grouping
    pass


def test_p9_local_answer_normalizes_arabic_variants():
    from pylegal import local_answer as la
    out = la.local_answer('اجاره‌نامه فسخ', passages=['اين اجاره‌نامه با شرط فسخ فوري امضا شد', 'فوتبال سرگرمی است'])
    assert out['answered']
    assert 'اجاره‌نامه' in out['spans'][0]['sentence']


def test_p9_local_answer_bigram_beats_bag_of_words():
    from pylegal import local_answer as la
    scattered = 'واژه‌های اجاره و فسخ پراکنده‌اند اجاره فسخ اجاره فسخ اجاره فسخ'
    phrase = 'قانون می‌گوید فسخ اجاره‌نامه در ماده کذایی آمده است'
    out = la.local_answer('فسخ اجاره‌نامه', passages=[scattered, phrase])
    assert out['answered']
    assert out['spans'][0]['sentence'] == phrase
