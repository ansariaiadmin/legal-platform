# pylegal — Python sidecar workers (فاز ۱c)

Stdlib-only companion to the agent fleet (SPEC §11a, ADR-010). The NestJS
orchestrator owns *decisions*; these workers own *deterministic text chores*
(Persian normalization, legal chunking, citation extraction) so agents move
faster without risking authority.

```
apps/workers/py/
├── pylegal/
│   ├── __init__.py      # version + queue/result key constants
│   ├── persian_tools.py # normalize / split_sentences / chunk / article_refs
│   ├── resp_client.py   # minimal RESP2-over-socket client (stdlib only)
│   └── worker.py        # BLPOP loop; result posted to legal:workers:result:<jobId>
└── tests/               # unittest suite (21 tests)
```

## Run

```bash
cd apps/workers/py
python3 -m unittest discover -s tests -v   # tests
python3 -m pylegal.worker                   # loop (needs REDIS_URL)
```

## Wire-in (later phases)

- **P2-T2 collectors** call `chunk_legal_text` before embedding; hashes must
  be reproducible, which only a deterministic chunker guarantees.
- The API enqueues `{jobId, tool, input}` on `legal:workers:queue`; the worker
  answers at `legal:workers:result:<jobId>` (TTL 3600s).
- Docker: `infra/docker/workers.Dockerfile` references this dir (P6 deploy task).

## Why stdlib only

The healthcheck-style client in `apps/api` sends PING over a raw socket for the
same reason: infrastructure access stays thin, reviewable, and portable. If we
ever need TLS or pipes, swapping `resp_client.py` for `redis-py` is a one-file
change behind the `RespClient` class surface.
