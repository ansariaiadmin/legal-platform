"""Minimal RESP2 client (Redis) — stdlib sockets only.

The NestJS side has the same philosophy (see providers/*): we use infra
directly and minimally rather than pulling an SDK. One connection per call;
responses parsed per RESP2 spec. Supports just what the worker needs:
LPUSH / BLPOP / SET(with EX) / GET / PING / AUTH.
"""
from __future__ import annotations

import socket
from typing import Optional
from urllib.parse import urlparse


class RespError(Exception):
    pass


class RespClient:
    def __init__(self, url: str, timeout_s: float = 5.0):
        parsed = urlparse(url)
        if parsed.scheme not in ("redis", "rediss") or not parsed.hostname:
            raise ValueError(f"bad redis url: {url!r}")
        if parsed.scheme == "rediss":
            raise RespError("rediss:// (TLS) not supported by the minimal client")
        self.host = parsed.hostname
        self.port = parsed.port or 6379
        self.password = parsed.password
        self.timeout = timeout_s

    # ---------- wire ----------

    def _cmd(self, *args: str) -> "RESP":
        data = b""
        data += f"*{len(args)}\r\n".encode()
        for a in args:
            b = a.encode("utf-8")
            data += f"${len(b)}\r\n".encode() + b + b"\r\n"
        with socket.create_connection((self.host, self.port), timeout=self.timeout) as s:
            s.sendall(data)
            f = s.makefile("rb")
            return self._parse(f)

    def _parse(self, f) -> "RESP":  # noqa: ANN001 - file-like binary reader
        line = f.readline()
        if not line:
            raise RespError("connection closed")
        t, body = line[:1], line[1:].strip()
        if t == b"+":
            return body.decode("utf-8")
        if t == b"-":
            raise RespError(body.decode("utf-8"))
        if t == b":":
            return int(body)
        if t == b"$":
            n = int(body)
            if n == -1:
                return None
            data = f.read(n + 2)  # payload + CRLF
            return data[:-2].decode("utf-8")
        if t == b"*":
            n = int(body)
            if n == -1:
                return None
            return [self._parse(f) for _ in range(n)]
        raise RespError(f"unknown RESP type: {t!r}")

    def call(self, *args: str):
        # AUTH ships as its own one-shot call before the real command when a
        # password is configured. Slightly chatty, perfectly explicit.
        if self.password and args[0] != "AUTH":
            auth = self._cmd("AUTH", self.password)
            if auth != "OK":
                raise RespError(f"auth failed: {auth}")
        return self._cmd(*args)

    # ---------- API ----------

    def ping(self) -> bool:
        return self._cmd("PING") == "PONG"

    def lpush(self, key: str, *values: str) -> int:
        return int(self.call("LPUSH", key, *values))

    def blpop(self, key: str, timeout_s: int = 5) -> Optional[list]:
        return self.call("BLPOP", key, str(timeout_s))

    def set(self, key: str, value: str, ex: Optional[int] = None) -> bool:
        args = ("SET", key, value) + (("EX", str(ex)) if ex else ())
        return self.call(*args) == "OK"

    def get(self, key: str) -> Optional[str]:
        return self.call("GET", key)
