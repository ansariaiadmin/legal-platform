import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { RedisRespClient } from '../../providers/queue/redis-resp.client';

export const PY_QUEUE_KEY = 'legal:workers:queue';
export const PY_RESULT_PREFIX = 'legal:workers:result:';

export type PyToolName =
  | 'normalize_persian'
  | 'chunk_legal_text'
  | 'article_refs'
  | 'word_count'
  | 'ask_model'
  | 'file_digest'
  | 'extract_any'
  // P6: always-on worker contract — liveness + static sec scan + no-model QA
  | 'ping'
  | 'security_scan'
  | 'local_answer';

export interface PyJobHandle {
  jobId: string;
  queued: boolean;
}

export interface PyJobResult {
  jobId: string;
  ok: boolean;
  error?: string;
  output?: Record<string, unknown>;
}

/**
 * Bridge API ↔ python workers (ADR-010). Jobs get queued on the same Redis
 * the SPEC (§2) already mandates; results are polled at a TTL'd result key.
 * Queue failure degrades honestly — `queued:false`, never a fake result.
 */
@Injectable()
export class PythonWorkerService {
  constructor(private readonly config: ConfigService) {}

  private client(): RedisRespClient {
    return new RedisRespClient(this.config.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379');
  }

  async enqueue(tool: PyToolName, input: Record<string, unknown>): Promise<PyJobHandle> {
    const jobId = `py-${randomUUID()}`;
    const payload = JSON.stringify({ jobId, tool, input });
    try {
      await this.client().lpush(PY_QUEUE_KEY, payload);
      return { jobId, queued: true };
    } catch {
      return { jobId, queued: false }; // queue down = queued:false, honestly
    }
  }

  async result(jobId: string): Promise<PyJobResult | null> {
    try {
      const raw = await this.client().get(`${PY_RESULT_PREFIX}${jobId}`);
      return raw ? (JSON.parse(raw) as PyJobResult) : null;
    } catch {
      return null; // unavailable result store = unknown, not success
    }
  }

  /**
   * Liveness probe (P6-S4): enqueue `ping`, poll result up to `timeoutMs`.
   * Any silence/latency/queue failure ⇒ alive:false with an honest reason —
   * the Security Guardian shows this, dashboards never pretend the local
   * floor stands when the queue is down.
   */
  async probe(timeoutMs = 2_500): Promise<{ alive: boolean; detail?: string }> {
    const handle = await this.enqueue('ping', {});
    if (!handle.queued) {
      return { alive: false, detail: 'redis queue unreachable (enqueue failed)' };
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await this.result(handle.jobId);
      if (res) {
        if (res.ok) return { alive: true, detail: JSON.stringify(res.output ?? {}) };
        return { alive: false, detail: res.error ?? 'workers answered with failure' };
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    return { alive: false, detail: `no ping answer within ${timeoutMs}ms` };
  }

  /** Fire-and-collect convenience for callers that need the tool output
   *  (security_scan, local_answer). Returns null when the queue/store is
   *  unreachable or the job times out — callers degrade, callers never fake. */
  async runTool(
    tool: PyToolName,
    input: Record<string, unknown>,
    timeoutMs = 8_000,
  ): Promise<PyJobResult | null> {
    const handle = await this.enqueue(tool, input);
    if (!handle.queued) return null;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await this.result(handle.jobId);
      if (res) return res;
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  }
}

