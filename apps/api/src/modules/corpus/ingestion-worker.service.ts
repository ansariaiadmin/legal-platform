import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';
import { InProcessAgentEventBus } from '../orchestrator/agent-event-bus';
import { CollectorAgentService } from './collector-agent.service';
import { CorpusService } from './corpus.service';
import { DataValidatorService } from './data-validator.service';

/**
 * P2-T5: the ingestion worker's job state machine, persisted through the
 * StorageProvider port (`runtime/corpus/jobs.json`) — the Redis queue from
 * the roadmap arrives as the same SHAPES (queued → running → succeeded |
 * partial_success | failed) on infra later; the truth of the lifecycle and
 * its accounting live here.
 *
 * Idempotency: a run key = (sourceId, windowLabel) yields the SAME jobId
 * forever; re-running collects, but identical sha256 rows never double-shelve
 * (CorpusService dedupes). partial_success is counted honestly: attempted /
 * succeeded / failed per SPEC §9.
 */

export type IngestionJobStatus = 'queued' | 'running' | 'succeeded' | 'partial_success' | 'failed';

export interface IngestionJobRecord {
  jobId: string;
  sourceId: string;
  windowLabel: string;
  status: IngestionJobStatus;
  attempted: number;
  succeeded: number;
  failed: number;
  /** ids of documents shelved by this run (or already shelved — dedupe wins) */
  documentIds: string[];
  /** sha256s that failed validation (NOT written verified) */
  rejectedIds: string[];
  startedAt: string;
  finishedAt: string | null;
  errorSummary: string | null;
  retryOf: string | null;
}

const JOBS_KEY = 'runtime/corpus/jobs.json';

@Injectable()
export class IngestionWorkerService {
  private readonly logger = new Logger(IngestionWorkerService.name);
  private readonly jobs = new Map<string, IngestionJobRecord>();
  private loaded = false;

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly collector: CollectorAgentService,
    private readonly corpus: CorpusService,
    private readonly validator: DataValidatorService,
    @Optional() @Inject(forwardRef(() => InProcessAgentEventBus)) private readonly bus?: InProcessAgentEventBus,
  ) {}

  private async ensure(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.storage.get(JOBS_KEY);
      const parsed = JSON.parse(raw.toString('utf8')) as IngestionJobRecord[];
      for (const j of parsed) this.jobs.set(j.jobId, j);
    } catch { /* first boot — empty log is honest */ }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.storage.put({
      key: JOBS_KEY,
      content: Buffer.from(JSON.stringify([...this.jobs.values()])),
      contentType: 'application/json',
      metadata: { kind: 'corpus-jobs' },
    });
  }

  /** Deterministic id for (source, window) — retried syncs hit the same row. */
  private jobIdFor(sourceId: string, windowLabel: string): string {
    return createHash('sha256')
      .update(`${sourceId}/${windowLabel}`)
      .digest('hex')
      .slice(0, 16);
  }

  /** Sync a source's latest window. Same window = same job = no double work. */
  async sync(sourceId: string, windowLabel?: string, retryOf?: string): Promise<IngestionJobRecord> {
    await this.ensure();
    const window = windowLabel ?? new Date().toISOString().slice(0, 10);
    const jobId = this.jobIdFor(sourceId, window);

    // idempotent re-run: a finished job for the same window replays as a NO-OP
    const existing = this.jobs.get(jobId);
    if (existing && existing.status !== 'failed' && !retryOf) {
      this.logger.log(`job ${jobId} already ${existing.status} — idempotent replay skipped`);
      return existing;
    }

    const job: IngestionJobRecord = existing ?? {
      jobId,
      sourceId,
      windowLabel: window,
      status: 'queued',
      attempted: 0,
      succeeded: 0,
      failed: 0,
      documentIds: [],
      rejectedIds: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      errorSummary: null,
      retryOf: retryOf ?? null,
    };
    job.status = 'running';
    job.retryOf = retryOf ?? job.retryOf;
    // a retry re-counts FRESH — the shelf dedupes by sha256, the numbers never lie
    job.attempted = 0;
    job.succeeded = 0;
    job.failed = 0;
    job.documentIds = [];
    job.rejectedIds = [];
    job.errorSummary = null;
    job.startedAt = new Date().toISOString();
    job.finishedAt = null;
    this.jobs.set(jobId, job);

    this.bus?.emit({
      kind: 'corpus.ingested',
      at: new Date().toISOString(),
      taskId: jobId,
      agentId: 'legal-leader',
      detail: `sync ${sourceId} @ ${window}${retryOf ? ' (retry)' : ''}`,
    });

    try {
      // the sync itself REGISTERS the source on the shelf — sources §9 live
      // with their sync history, not in a admin-only back office
      await this.corpus.registerSource({
        sourceKey: sourceId,
        displayName: sourceId,
        trustTier: 1,
        enabled: true,
      });

      const run = await this.collector.collect({
        taskId: jobId,
        query: `sync:${sourceId}`,
        context: [sourceId, window],
      });
      job.attempted = run.attempted;
      job.failed = run.failed;

      for (const item of run.items) {
        // 1) shelve (dedupe by sha256 inside)
        const [titleLine] = item.rawText.split('\n');
        const doc = await this.corpus.ingestDocument({
          sourceKey: sourceId,
          canonicalTitle: titleLine.trim() || 'سند جمع‌شده',
          bodyRaw: item.rawText,
          trustTier: item.trustTier,
          ingestedBy: `collector:${sourceId}`,
        });
        job.documentIds.push(doc.documentId);

        // 2) the validator gate — tick lands ONLY if every rule passes
        const v = await this.validator.validate(item);
        if (v.verified && !doc.verifiedAt) {
          await this.corpus.markVerified(doc.documentId, `validator:auto`);
        } else if (!v.verified) {
          job.rejectedIds.push(doc.sha256.slice(0, 12));
          this.logger.warn(`doc «${doc.canonicalTitle}» rejected: ${v.reasons.join(' / ')}`);
        }
      }

      job.succeeded = job.documentIds.length;
      job.status =
        job.failed > 0 && job.succeeded > 0 ? 'partial_success'
        : job.failed > 0 ? 'failed'
        : 'succeeded';
      job.finishedAt = new Date().toISOString();
    } catch (e) {
      job.status = 'failed';
      job.errorSummary = (e as Error).message.slice(0, 300);
      job.finishedAt = new Date().toISOString();
    }

    await this.persist();
    this.bus?.emit({
      kind: 'corpus.validated',
      at: new Date().toISOString(),
      taskId: jobId,
      agentId: 'legal-leader',
      detail: `job ${job.status}: ${job.succeeded}/${job.attempted} shelved, ${job.failed} failed`,
    });
    return { ...job };
  }

  async list(): Promise<IngestionJobRecord[]> {
    await this.ensure();
    return [...this.jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** Diagnostics view: only the jobs that need a human eye, with context. */
  async failures(): Promise<IngestionJobRecord[]> {
    const all = await this.list();
    return all.filter((j) => j.status === 'failed' || j.status === 'partial_success' || j.rejectedIds.length > 0);
  }

  /** Manual retry from diagnostics — honest new attempt, linked to the old run. */
  async retry(jobId: string): Promise<IngestionJobRecord | null> {
    await this.ensure();
    const old = this.jobs.get(jobId);
    if (!old) return null;
    // a FAILED job re-runs in place (same id → same window → dedupe still holds);
    // a finished-but-partial job spawns a fresh keyed run marked as retry
    if (old.status === 'failed') {
      return this.sync(old.sourceId, old.windowLabel, old.jobId);
    }
    return this.sync(old.sourceId, old.windowLabel, old.jobId);
  }
}
