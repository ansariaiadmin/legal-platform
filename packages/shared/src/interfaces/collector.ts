import type { AgentTask, IAgent } from './agent';

/** Provenance for one ingested unit — SPEC §9 preserves it end to end. */
export interface CollectedItem {
  sourceUrl: string;
  fetchedAt: string; // ISO timestamp
  contentSha256: string;
  rawText: string;
  /** Trust tier per SPEC §9: 1 official, 2 lawyer-approved, 3 general. */
  trustTier: 1 | 2 | 3;
}

export interface CollectorRunResult {
  jobId: string;
  items: CollectedItem[];
  /** counts so ingestion_jobs can report partial_success honestly (§6) */
  attempted: number;
  succeeded: number;
  failed: number;
}

export interface ICollectorAgent extends IAgent {
  readonly kind: 'collector';
  /** Stable source identifier, e.g. 'rooznameh-rasmi'. */
  readonly sourceId: string;
  readonly schedule?: { cron: string }; // informational; scheduler lives in api
  collect(task: AgentTask): Promise<CollectorRunResult>;
}

/** Marks data verified — the "green tick". */
export interface IValidatorAgent extends IAgent {
  readonly kind: 'validator';
  validate(item: CollectedItem): Promise<{
    verified: boolean; // set verified_at in DB ONLY when true
    reasons: string[];
  }>;
}

/** Temporal versioning: incoming vs stored, supersession-aware. */
export interface IUpdaterAgent extends IAgent {
  readonly kind: 'updater';
  /** Returns version bump info; never mutates history rows, only appends. */
  diff(task: AgentTask): Promise<{
    changed: boolean;
    newVersion?: { validFrom: string; validTo: string | null; supersedes?: string };
  }>;
}
