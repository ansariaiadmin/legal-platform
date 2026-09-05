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
  | 'ask_model';

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
}
