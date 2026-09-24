/**
 * KnowledgeGraph — temporal/versioned law storage port (SPEC §11a pillar 2).
 * Implementation lands in Phase 2 over the ai/corpus tables (pgvector). This
 * is the PORT only; law is versioned in time, never mutated in place.
 */

export interface LawNodeId {
  /** e.g. 'civil-code' */
  corpus: string;
  /** e.g. 'article-10' */
  nodeId: string;
}

export interface LawVersion {
  versionId: string;
  validFrom: string; // ISO date of legal effect, not ingestion time
  validTo: string | null; // null = currently in force
  text: string;
  sourceId: string;
  trustTier: 1 | 2 | 3;
  verifiedAt: string | null; // the validator's green tick
  ingestedAt: string; // provenance: when WE saw it
  contentSha256: string;
}

export interface LawNode extends LawNodeId {
  title: string;
  /** version history, append-only, newest first */
  versions: readonly LawVersion[];
  /** graph edges: cites / amends / repeals / interprets */
  edges?: ReadonlyArray<{ to: LawNodeId; relation: 'cites' | 'amends' | 'repeals' | 'interprets' }>;
}

export interface TemporalQuery {
  node: LawNodeId;
  /** as-of date; omit for "current". */
  asOf?: string;
  /** include unverified versions (default false — drafts must cite verified). */
  includeUnverified?: boolean;
}

export interface KnowledgeGraph {
  getNode(id: LawNodeId): Promise<LawNode | null>;
  /** Point-in-time read: the version legally in force at asOf. */
  getVersionAt(query: TemporalQuery): Promise<LawVersion | null>;
  /** Full append-only history for auditing/version diffs. */
  history(id: LawNodeId): Promise<readonly LawVersion[]>;
  /** Neighbours one hop out, for "what does this article touch" questions. */
  related(id: LawNodeId): Promise<readonly LawNodeId[]>;
}
