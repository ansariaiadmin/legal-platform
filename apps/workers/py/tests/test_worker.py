import unittest

from pylegal.worker import handle, TOOLS


class TestHandle(unittest.TestCase):
    def test_normalize_persian_ok(self):
        r = handle({"jobId": "j1", "tool": "normalize_persian", "input": {"text": "شرايط الكي"}})
        self.assertTrue(r["ok"])
        self.assertEqual(r["output"]["normalized"], "شرایط الکی")
        self.assertEqual(r["tool"], "normalize_persian")

    def test_unknown_tool_rejected(self):
        r = handle({"jobId": "j2", "tool": "nope", "input": {}})
        self.assertFalse(r["ok"])
        self.assertIn("unknown tool", r["error"])

    def test_tool_exception_isolated_not_crashed(self):
        r = handle({"jobId": "j3", "tool": "normalize_persian", "input": {"text": 1}})
        self.assertFalse(r["ok"])
        self.assertIn("TypeError", r["error"])

    def test_jobs_get_ids(self):
        r = handle({"tool": "word_count", "input": {"text": "یک دو سه"}})
        self.assertTrue(r["jobId"].startswith("py-"))

    def test_tools_registry_pure(self):
        self.assertEqual(
            sorted(TOOLS.keys()),
            # P6-S4 added the always-on contract: ping / security_scan / local_answer
            ["article_refs", "ask_model", "chunk_legal_text", "extract_any",
             "file_digest", "local_answer", "normalize_persian", "ping",
             "security_scan", "word_count"],
        )

    def test_ask_model_without_config_is_honest(self):
        import os
        for k in ("PYLEGAL_LOCAL_MODEL_URL", "PYLEGAL_LOCAL_MODEL",
                  "PYLEGAL_CLOUD_MODEL_URL", "PYLEGAL_CLOUD_MODEL", "PYLEGAL_CLOUD_MODEL_KEY"):
            os.environ.pop(k, None)
        r = handle({"jobId": "j4", "tool": "ask_model", "input": {"text": "ماده ۱۰"}})
        self.assertTrue(r["ok"])
        self.assertFalse(r["output"]["answered"])
        self.assertEqual(r["output"]["reason"], "no_model_configured")


if __name__ == "__main__":
    unittest.main()
