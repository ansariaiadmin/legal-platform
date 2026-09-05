FROM python:3.11-slim AS base

# pylegal worker (apps/workers/py) — stdlib only, so no pip install step
# at all. That is the point: zero supply-chain surface in the build.
WORKDIR /app
COPY apps/workers/py /app/apps/workers/py

ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/apps/workers/py \
    REDIS_URL=redis://redis:6379

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python3 -c "import os,socket; s=socket.create_connection((os.environ.get('REDIS_URL','redis://127.0.0.1:6379').split('//')[1].split(':')[0],6379),2); s.sendall(b'PING\r\n'); assert b'PONG' in s.recv(32)"

CMD ["python3", "-m", "pylegal.worker"]
