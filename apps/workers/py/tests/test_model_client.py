import json
import socketserver
import threading
import unittest
from http.server import BaseHTTPRequestHandler

from pylegal.model_client import ModelConfig, ModelCallError, chat_completion


class FakeGateway(BaseHTTPRequestHandler):
    """Fakes just enough of /v1/chat/completions for wire tests."""

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        auth = self.headers.get("Authorization", "")
        if self.path != "/v1/chat/completions":
            self.send_response(404)
            self.end_headers()
            return
        if self.server.require_auth and auth != f"Bearer {self.server.api_key}":
            self.send_response(401)
            self.end_headers()
            self.wfile.write(json.dumps({"error": "unauthorized"}).encode())
            return
        reply = {
            "choices": [{"message": {"role": "assistant", "content": f"echo:{body['messages'][-1]['content'][:20]}"}}],
            "model": body["model"],
            "usage": {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8},
        }
        data = json.dumps(reply).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_):  # silenceHTTP
        pass


class FakeGatewayServer(socketserver.TCPServer):
    require_auth = False
    api_key = ""


class TestChatCompletion(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = FakeGatewayServer(("127.0.0.1", 0), FakeGateway)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_happy_path_no_auth(self):
        cfg = ModelConfig(base_url=f"http://127.0.0.1:{self.port}", api_key="", model="qwen-test")
        out = chat_completion(cfg, [{"role": "user", "content": "سلام دنیا حقوقی"}])
        self.assertTrue(out["text"].startswith("echo:"))
        self.assertEqual(out["model"], "qwen-test")
        self.assertEqual(out["usage"]["total_tokens"], 8)

    def test_auth_header_sent_when_key_set(self):
        FakeGatewayServer.require_auth = True
        FakeGatewayServer.api_key = "sekret"
        try:
            cfg = ModelConfig(base_url=f"http://127.0.0.1:{self.port}", api_key="sekret", model="m")
            out = chat_completion(cfg, [{"role": "user", "content": "hi"}])
            self.assertTrue(out["text"])
            bad = ModelConfig(base_url=f"http://127.0.0.1:{self.port}", api_key="wrong", model="m")
            with self.assertRaises(ModelCallError) as ctx:
                chat_completion(bad, [{"role": "user", "content": "hi"}])
            self.assertEqual(ctx.exception.status, 401)
            self.assertFalse(ctx.exception.retryable)
        finally:
            FakeGatewayServer.require_auth = False

    def test_unreachable_is_retryable(self):
        cfg = ModelConfig(base_url="http://127.0.0.1:1", api_key="", model="m", timeout_s=0.2)
        with self.assertRaises(ModelCallError) as ctx:
            chat_completion(cfg, [{"role": "user", "content": "hi"}])
        self.assertTrue(ctx.exception.retryable)

    def test_api_key_never_leaks_to_url(self):
        cfg = ModelConfig(base_url=f"http://127.0.0.1:{self.port}", api_key="KEY", model="m")
        req_url = cfg.base_url + "/v1/chat/completions"
        self.assertNotIn("KEY", req_url)


if __name__ == "__main__":
    unittest.main()
