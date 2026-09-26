import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { AI_PROVIDER } from '../../providers/provider.tokens';
import type { AIProvider } from '../../providers/ai/ai.provider';
import { CorpusService, type CorpusDocument } from '../corpus/corpus.service';
import type { SemanticHit } from './embedding-index.service';

const CHUNK_SIZE = 700;
const CHUNK_OVERLAP = 100;

interface PendingChunk {
  chunkId: string;
  documentId: string;
  canonicalTitle: string;
  trustTier: 1 | 2 | 3;
  position: number;
  content: string;
  embedding: number[];
}

type IndexResult = { indexed: number; dimension: number | null; degraded: string | null; pg: boolean };

/**
 * pgvector-backed semantic index (table `rag_chunks`, migration 010).
 *
 * Used instead of the JSON index (EmbeddingIndexService) when Postgres has
 * the pgvector extension and the table exists; `pickSemanticIndex()` makes
 * that choice for both writers (rebuild) and readers (drafting), so the two
 * can never disagree about which index is live.
 *
 * Rebuild embeds every chunk first and then replaces all rows in a single
 * transaction: a failure leaves the previous index intact.
 */
@Injectable()
export class PgEmbeddingIndexService {
  private readonly logger = new Logger(PgEmbeddingIndexService.name);
  private dimension: number | null = null;
  private pgAvailable = false;
  private readonly ready: Promise<void>;

  constructor(
    private readonly pool: Pool,
    private readonly corpus: CorpusService,
    @Optional() @Inject(AI_PROVIDER) private readonly ai?: AIProvider,
  ) {
    this.ready = this.probe();
  }

  /** Resolves once the pgvector probe has finished (used by tests and ops). */
  whenReady(): Promise<void> {
    return this.ready;
  }

  private async probe(): Promise<void> {
    try {
      const res = await this.pool.query<{ has_vector: boolean; has_table: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS has_vector,
                to_regclass('public.rag_chunks') IS NOT NULL AS has_table`,
      );
      const row = res.rows[0];
      this.pgAvailable = Boolean(row?.has_vector && row?.has_table);
      if (this.pgAvailable) {
        const dim = await this.pool.query<{ dimension: number }>('SELECT dimension FROM rag_chunks LIMIT 1');
        this.dimension = dim.rows[0]?.dimension ?? null;
        this.logger.log('pgvector index available (rag_chunks)');
      } else {
        this.logger.log('pgvector index unavailable; the JSON semantic index is used');
      }
    } catch {
      this.pgAvailable = false;
    }
  }

  availability(): { degraded: string | null; pg: boolean } {
    if (!this.ai) return { degraded: 'no_embedding_provider', pg: this.pgAvailable };
    if (!this.pgAvailable) return { degraded: 'pgvector_unavailable', pg: false };
    return { degraded: null, pg: true };
  }

  async rebuild(): Promise<IndexResult> {
    await this.ready;
    if (!this.ai) return { indexed: 0, dimension: this.dimension, degraded: 'no_embedding_provider', pg: this.pgAvailable };
    if (!this.pgAvailable) return { indexed: 0, dimension: this.dimension, degraded: 'pgvector_unavailable', pg: false };

    const docs = await this.corpus.list({ verifiedOnly: true });
    const pending: PendingChunk[] = [];
    let dim: number | null = null;
    for (const doc of docs) {
      for (const chunk of toChunks(doc)) {
        const emb = await this.ai.embedText({ text: chunk.content });
        if (dim !== null && emb.dimension !== dim) {
          throw new Error(`embedding dimension changed mid-rebuild (${dim} → ${emb.dimension})`);
        }
        dim = emb.dimension;
        pending.push({
          ...chunk,
          documentId: doc.documentId,
          canonicalTitle: doc.canonicalTitle,
          trustTier: doc.trustTier,
          embedding: emb.embedding,
        });
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM rag_chunks');
      for (const c of pending) {
        await client.query(
          `INSERT INTO rag_chunks
             (chunk_id, document_id, canonical_title, trust_tier, position, content, dimension, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)`,
          [c.chunkId, c.documentId, c.canonicalTitle, c.trustTier, c.position, c.content, c.embedding.length, toVector(c.embedding)],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      this.logger.error(`pgvector rebuild failed; previous index kept: ${(e as Error).message}`);
      throw e;
    } finally {
      client.release();
    }

    this.dimension = dim ?? this.dimension;
    this.logger.log(`pgvector index rebuilt: ${pending.length} chunks, dimension ${this.dimension ?? '-'}`);
    return { indexed: pending.length, dimension: this.dimension, degraded: null, pg: true };
  }

  async search(query: string, opts?: { topK?: number }): Promise<SemanticHit[]> {
    await this.ready;
    if (!this.ai || !this.pgAvailable) return [];
    const topK = opts?.topK ?? 5;
    const q = await this.ai.embedText({ text: query });
    if (this.dimension !== null && q.dimension !== this.dimension) {
      this.logger.warn(`query dimension ${q.dimension} does not match index dimension ${this.dimension}; rebuild the index`);
      return [];
    }

    try {
      const res = await this.pool.query<{
        document_id: string;
        canonical_title: string;
        trust_tier: number;
        content: string;
        similarity: string | number;
      }>(
        `SELECT document_id, canonical_title, trust_tier, content,
                1 - (embedding <=> $1::vector) AS similarity
           FROM rag_chunks
          WHERE dimension = $2
          ORDER BY embedding <=> $1::vector
          LIMIT $3`,
        [toVector(q.embedding), q.dimension, topK * 3],
      );
      const perDoc = new Map<string, SemanticHit>();
      for (const row of res.rows) {
        const score = Number(row.similarity);
        if (!(score > 0) || perDoc.has(row.document_id)) continue;
        perDoc.set(row.document_id, {
          documentId: row.document_id,
          canonicalTitle: row.canonical_title,
          trustTier: row.trust_tier as 1 | 2 | 3,
          score,
          preview: row.content.slice(0, 200),
        });
      }
      return [...perDoc.values()].slice(0, topK);
    } catch (e) {
      this.logger.error(`pgvector search failed: ${(e as Error).message}`);
      return [];
    }
  }

  async stats(): Promise<{ chunks: number; documents: number; dimension: number | null; degraded: string | null; pg: boolean }> {
    await this.ready;
    const { degraded, pg } = this.availability();
    if (!this.pgAvailable) return { chunks: 0, documents: 0, dimension: this.dimension, degraded, pg };
    try {
      const res = await this.pool.query<{ chunks: string; docs: string }>(
        'SELECT COUNT(*) AS chunks, COUNT(DISTINCT document_id) AS docs FROM rag_chunks',
      );
      return {
        chunks: Number(res.rows[0]?.chunks ?? 0),
        documents: Number(res.rows[0]?.docs ?? 0),
        dimension: this.dimension,
        degraded,
        pg,
      };
    } catch (e) {
      this.logger.error(`pgvector stats failed: ${(e as Error).message}`);
      return { chunks: 0, documents: 0, dimension: this.dimension, degraded: 'pgvector_stats_failed', pg };
    }
  }
}

/** Single decision point: which semantic index is live for reads and writes. */
export function pickSemanticIndex<T>(jsonIndex: T, pgIndex?: PgEmbeddingIndexService): T | PgEmbeddingIndexService {
  return pgIndex && pgIndex.availability().pg ? pgIndex : jsonIndex;
}

function toVector(values: number[]): string {
  return `[${values.join(',')}]`;
}

function toChunks(doc: CorpusDocument): Array<{ chunkId: string; position: number; content: string }> {
  const chunks: Array<{ chunkId: string; position: number; content: string }> = [];
  const body = doc.bodyRaw;
  let position = 0;
  let offset = 0;
  while (offset < body.length) {
    const end = Math.min(body.length, offset + CHUNK_SIZE);
    const content = body.slice(offset, end).trim();
    if (content.length > 0) {
      chunks.push({
        chunkId: createHash('sha256').update(`${doc.documentId}:${position}`).digest('hex').slice(0, 32),
        position,
        content,
      });
      position += 1;
    }
    if (end === body.length) break;
    offset = Math.max(offset + 1, end - CHUNK_OVERLAP);
  }
  return chunks;
}
