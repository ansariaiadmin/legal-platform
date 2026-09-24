import socketserver
import threading
import unittest

from pylegal.resp_client import RespClient, RespError


class FakeRedis(socketserver.BaseRequestHandler):
    """Just enough of a Redis to test the codec end to end."""

    def handle(self):
        data = self.request.recv(65536)
        # decode the multi-bulk and re-emit a canned reply
        parts = data.split(b"\r\n")
        # parts look like: [*3, $3, GET, $3, key, ""]
        cmd = parts[2].decode().upper()
        if cmd == "PING":
            self.request.sendall(b"+PONG\r\n")
        elif cmd == "GET":
            self.request.sendall(b"$5\r\nvalue\r\n")
        elif cmd == "AUTH":
            self.request.sendall(b"+OK\r\n")


class TestRespClient(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = socketserver.TCPServer(("127.0.0.1", 0), FakeRedis)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_ping_roundtrip(self):
        c = RespClient(f"redis://127.0.0.1:{self.port}")
        self.assertTrue(c.ping())

    def test_bulk_string_get(self):
        c = RespClient(f"redis://127.0.0.1:{self.port}")
        self.assertEqual(c.get("key"), "value")

    def test_bad_url_rejected(self):
        with self.assertRaises(ValueError):
            RespClient("not-a-url")

    def test_tls_scheme_refused(self):
        with self.assertRaises(RespError):
            RespClient("rediss://127.0.0.1:6379")


if __name__ == "__main__":
    unittest.main()
