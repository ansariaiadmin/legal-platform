import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AI_PROVIDER, STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { AIProvider } from '../../providers/ai/ai.provider';
import type { StorageProvider } from '../../providers/storage/storage.provider';
import { CorpusService, type CorpusDocument } from '../corpus/corpus.service';

/**
 * P4-T1: the semantic index. Every chunk of every SHELVED document gets an
 * embedding from `providers/ai` (dimension from provider metadata — never
 * hardcoded 1536) and lands in a cosine-searchable store. No provider
 * reachable → the index stays EMPTY and every call reports
 * `degraded: 'no_embedding_provider'` — honestly degraded, not silent
 * garbage (lexical corpus search keeps answering meanwhile).
 *
 * Shape is a PORT: `EmbeddingIndexStore` is replaceable by a pgvector SQL
 * implementation when the runtime has one — same upsert/search surface,
 * same eviction key (documentId). Serialized via StorageProvider now
 * (`runtime/rag/index.json`).
 */

export interface IndexEntry {
  documentId: string;
  canonicalTitle: string;
  chunkId: string;
  position: number;
  content: string;
  vector: number[];
  trustTier: 1 | 2 | 3;
  verified: boolean;
  sha256: string;
  ingestedAt: string;
}

export interface SemanticHit {
  documentId: string;
  canonicalTitle: string;
  trustTier: 1 | 2 | 3;
  score: number; // cosine 0..1
  preview: string;
}

interface EmbeddingStoreDoc {
  dimension: number;
  entries: IndexEntry[];
  builtAt: string;
}

const INDEX_KEY = 'runtime/rag/index.json';

export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

@Injectable()
export class EmbeddingIndexService {
  private readonly logger = new Logger(EmbeddingIndexService.name);
  private entries: IndexEntry[] = [];
  private dimension: number | null = null;
  private loaded = false;

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly corpus: CorpusService,
    @Optional() @Inject(AI_PROVIDER) private readonly ai?: AIProvider,
  ) {}

  availability(): { degraded: string | null } {
    return { degraded: this.ai ? null : 'no_embedding_provider' };
  }

  private async ensure(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.storage.get(INDEX_KEY);
      const parsed = JSON.parse(raw.toString('utf8')) as EmbeddingStoreDoc;
      this.entries = parsed.entries;
      this.dimension = parsed.dimension;
    } catch { /* empty shelf is the honest first state */ }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.storage.put({
      key: INDEX_KEY,
      content: Buffer.from(
        JSON.stringify({ dimension: this.dimension, entries: this.entries, builtAt: new Date().toISOString() }),
      ),
      contentType: 'application/json',
      metadata: { kind: 'rag-index' },
    });
  }

  /** Rebuild the whole vector index from the CURRENT corpus (verified rows
   *  win; retired rows never make it to the semantic shelf). Idempotent:
   *  rebuild produces a deterministic store, never accretes stale entries. */
  async rebuild(): Promise<{ indexed: number; dimension: number | null; degraded: string | null }> {
    await this.ensure();
    if (!this.ai) return { indexed: 0, dimension: this.dimension, degraded: 'no_embedding_provider' };

    const docs = await this.corpus.list({ verifiedOnly: true });
    const out: IndexEntry[] = [];
    let dim: number | null = null;
    for (const doc of docs) {
      const chunks = this.toChunks(doc);
      for (const chunk of chunks) {
        const emb = await this.ai.embedText({ text: chunk.content });
        dim = emb.dimension;
        out.push({
          documentId: doc.documentId,
          canonicalTitle: doc.canonicalTitle,
          chunkId: chunk.chunkId,
          position: chunk.position,
          content: chunk.content,
          vector: emb.embedding,
          trustTier: doc.trustTier,
          verified: true,
          sha256: doc.sha256,
          ingestedAt: doc.ingestedAt,
        });
      }
    }
    this.entries = out;
    this.dimension = dim ?? this.dimension;
    this.logger.log(`semantic index rebuilt: ${out.length} chunks @ dim=${this.dimension}`);
    await this.persist();
    return { indexed: out.length, dimension: this.dimension, degraded: null };
  }

  private toChunks(doc: CorpusDocument): Array<{ chunkId: string; position: number; content: string }> {
    // chunking stays deterministic: window over the raw body, stable ids
    const CHUNK = 700;
    const OVERLAP = 100;
    const chunks: Array<{ chunkId: string; position: number; content: string }> = [];
    let pos = 0;
    let off = 0;
    while (off < doc.bodyRaw.length) {
      const end = Math.min(doc.bodyRaw.length, off + CHUNK);
      const content = doc.bodyRaw.slice(off, end).trim();
      if (content.length > 0) {
        chunks.push({
          chunkId: createHash('sha256').update(`${doc.documentId}:${pos}`).digest('hex').slice(0, 24),
          position: pos,
          content,
        });
        pos += 1;
      }
      if (end === doc.bodyRaw.length) break;
      off = Math.max(off + 1, end - OVERLAP);
    }
    return chunks;
  }

  /** Pure cosine over stored vectors; dimension of the QUERY must match the
   *  index's — a mismatched model gives zero results rather than silent
   *  nonsense scores. */
  async search(query: string, opts?: { topK?: number }): Promise<SemanticHit[]> {
    await this.ensure();
    if (!this.ai || this.entries.length === 0) return [];
    const qEmb = await this.ai.embedText({ text: query });
    if (this.dimension !== null && qEmb.dimension !== this.dimension) {
      this.logger.warn(`query embed dim ${qEmb.dimension} ≠ index dim ${this.dimension} — refusing blend`);
      return [];
    }
    const scored = this.entries
      .map((e) => ({
        documentId: e.documentId,
        canonicalTitle: e.canonicalTitle,
        trustTier: e.trustTier,
        score: cosineSim(qEmb.embedding, e.vector),
        preview: e.content.slice(0, 200),
      }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score);

    // one row per document — the best chunk defines it
    const perDoc = new Map<string, SemanticHit>();
    for (const h of scored) {
      if (!perDoc.has(h.documentId)) perDoc.set(h.documentId, h);
    }
    return [...perDoc.values()].slice(0, opts?.topK ?? 5);
  }

  async stats(): Promise<{ chunks: number; documents: number; dimension: number | null; degraded: string | null }> {
    await this.ensure();
    return {
      chunks: this.entries.length,
      documents: new Set(this.entries.map((e) => e.documentId)).size,
      dimension: this.dimension,
      degraded: this.availability().degraded,
    };
  }
}
