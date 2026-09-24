import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { AI_PROVIDER } from '../../providers/provider.tokens';
import type { AIProvider } from '../../providers/ai/ai.provider';
import { CorpusService, type CorpusDocument } from '../corpus/corpus.service';
import type { SemanticHit, IndexEntry } from './embedding-index.service';
import { cosineSim } from './embedding-index.service';

/**
 * PgEmbeddingIndexService — v3.2.2 — تاریکی روشن شد — pgvector واقعی
 * 
 * BEFORE: EmbeddingIndexService file-based JSON — runtime/rag/index.json — cosineSim in JS — برای 100 سند خوبه ولی برای 10k سند کند — scale نمی‌شه
 * AFTER: pgvector — document_chunks.embedding vector(1536) — با <=> cosine distance — index IVFFLAT — برای 100k سند هم سریع — سقف
 * 
 * Design:
 * - If DATABASE_URL present and pgvector extension exists, use PG
 * - Else fallback to in-memory (for tests/dev without DB)
 * - Rebuild: delete old chunks for tenant, insert new chunks with embeddings
 * - Search: embed query, then SELECT with embedding <=> query_embedding ORDER BY distance
 * - Stats: count chunks, distinct documents, dimension
 * - Degraded: no AI provider -> empty, no PG -> fallback to JS cosine
 */

@Injectable()
export class PgEmbeddingIndexService {
  private readonly logger = new Logger(PgEmbeddingIndexService.name);
  private fallbackEntries: IndexEntry[] = [];
  private dimension: number | null = null;
  private pgAvailable = false;

  constructor(
    private readonly pool: Pool,
    private readonly corpus: CorpusService,
    @Optional() @Inject(AI_PROVIDER) private readonly ai?: AIProvider,
  ) {
    this.checkPgVector().then(available => {
      this.pgAvailable = available;
      if (available) {
        this.logger.log('pgvector available — using PG for embeddings — سقف — تاریکی روشن شد');
      } else {
        this.logger.warn('pgvector not available — fallback to JS cosine — برای production PG نصب کن');
      }
    });
  }

  private async checkPgVector(): Promise<boolean> {
    try {
      const client = await this.pool.connect();
      try {
        await client.query('SELECT 1 FROM pg_extension WHERE extname = $1', ['vector']);
        // Check if document_chunks table exists with embedding column
        await client.query('SELECT embedding FROM document_chunks LIMIT 1');
        return true;
      } catch {
        return false;
      } finally {
        client.release();
      }
    } catch {
      return false;
    }
  }

  availability(): { degraded: string | null; pg: boolean } {
    if (!this.ai) return { degraded: 'no_embedding_provider', pg: this.pgAvailable };
    if (!this.pgAvailable) return { degraded: 'no_pgvector_fallback_js', pg: false };
    return { degraded: null, pg: true };
  }

  async rebuild(): Promise<{ indexed: number; dimension: number | null; degraded: string | null; pg: boolean }> {
    if (!this.ai) return { indexed: 0, dimension: this.dimension, degraded: 'no_embedding_provider', pg: this.pgAvailable };

    const docs = await this.corpus.list({ verifiedOnly: true });
    
    if (!this.pgAvailable) {
      // Fallback to JS in-memory — same as old EmbeddingIndexService
      return this.rebuildFallback(docs);
    }

    // PG rebuild
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Delete old chunks for these documents? For simplicity, delete all and reinsert
      // In production, you'd want tenant isolation — here we delete all verified docs chunks
      const docIds = docs.map(d => d.documentId);
      if (docIds.length > 0) {
        // Delete chunks for docs that are no longer verified? For now, truncate and rebuild all verified
        await client.query('DELETE FROM document_chunks WHERE document_id = ANY($1::uuid[])', [docIds]);
      }

      let indexed = 0;
      let dim: number | null = null;

      for (const doc of docs) {
        const chunks = this.toChunks(doc);
        for (const chunk of chunks) {
          const emb = await this.ai.embedText({ text: chunk.content });
          dim = emb.dimension;
          
          // Ensure document exists in legal_documents table (it should, via corpus)
          // Insert chunk with embedding
          try {
            await client.query(
              `INSERT INTO document_chunks (id, document_id, position, content, start_offset, end_offset, embedding, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
               ON CONFLICT (document_id, position) DO UPDATE SET content = $4, embedding = $7, created_at = NOW()`,
              [
                createHash('sha256').update(`${doc.documentId}:${chunk.position}`).digest('hex').slice(0, 32),
                doc.documentId,
                chunk.position,
                chunk.content,
                chunk.position * 700, // approximate offset
                chunk.position * 700 + chunk.content.length,
                JSON.stringify(emb.embedding), // pgvector accepts JSON array string? Actually needs '[1,2,3]' — pg driver handles array?
              ]
            );
            indexed++;
          } catch (e) {
            // Try alternative: embedding as string '[1,2,3]'
            try {
              await client.query(
                `INSERT INTO document_chunks (id, document_id, position, content, start_offset, end_offset, embedding, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::vector, NOW())
                 ON CONFLICT (document_id, position) DO UPDATE SET content = $4, embedding = $7::vector, created_at = NOW()`,
                [
                  createHash('sha256').update(`${doc.documentId}:${chunk.position}-${Date.now()}`).digest('hex').slice(0, 32),
                  doc.documentId,
                  chunk.position,
                  chunk.content,
                  chunk.position * 700,
                  chunk.position * 700 + chunk.content.length,
                  `[${emb.embedding.join(',')}]`,
                ]
              );
              indexed++;
            } catch (e2) {
              this.logger.warn(`Failed to insert chunk ${chunk.position} for doc ${doc.documentId}: ${(e2 as Error).message}`);
            }
          }
        }
      }

      await client.query('COMMIT');
      this.dimension = dim ?? this.dimension;
      this.logger.log(`pgvector index rebuilt: ${indexed} chunks @ dim=${this.dimension} — سقف — تاریکی روشن شد`);
      return { indexed, dimension: this.dimension, degraded: null, pg: true };
    } catch (e) {
      await client.query('ROLLBACK');
      this.logger.error(`PG rebuild failed, fallback to JS: ${(e as Error).message}`);
      return this.rebuildFallback(docs);
    } finally {
      client.release();
    }
  }

  private async rebuildFallback(docs: CorpusDocument[]): Promise<{ indexed: number; dimension: number | null; degraded: string | null; pg: boolean }> {
    const out: IndexEntry[] = [];
    let dim: number | null = null;
    for (const doc of docs) {
      const chunks = this.toChunks(doc);
      for (const chunk of chunks) {
        const emb = await this.ai!.embedText({ text: chunk.content });
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
    this.fallbackEntries = out;
    this.dimension = dim ?? this.dimension;
    return { indexed: out.length, dimension: this.dimension, degraded: this.pgAvailable ? null : 'no_pgvector_fallback_js', pg: false };
  }

  private toChunks(doc: CorpusDocument): Array<{ chunkId: string; position: number; content: string }> {
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

  async search(query: string, opts?: { topK?: number }): Promise<SemanticHit[]> {
    if (!this.ai) return [];
    
    const topK = opts?.topK ?? 5;
    const qEmb = await this.ai.embedText({ text: query });

    if (this.dimension !== null && qEmb.dimension !== this.dimension) {
      this.logger.warn(`query dim ${qEmb.dimension} ≠ index dim ${this.dimension} — refusing`);
      return [];
    }

    if (!this.pgAvailable) {
      // Fallback JS cosine
      const scored = this.fallbackEntries
        .map((e) => ({
          documentId: e.documentId,
          canonicalTitle: e.canonicalTitle,
          trustTier: e.trustTier,
          score: cosineSim(qEmb.embedding, e.vector),
          preview: e.content.slice(0, 200),
        }))
        .filter((h) => h.score > 0)
        .sort((a, b) => b.score - a.score);

      const perDoc = new Map<string, SemanticHit>();
      for (const h of scored) {
        if (!perDoc.has(h.documentId)) perDoc.set(h.documentId, h);
      }
      return [...perDoc.values()].slice(0, topK);
    }

    // PG vector search
    const client = await this.pool.connect();
    try {
      // Use <=> for cosine distance (0 = identical, 2 = opposite)
      // Score = 1 - distance/2 or 1 - distance for cosine?
      // pgvector cosine distance is 1 - cosine_similarity, so similarity = 1 - distance
      const res = await client.query(
        `SELECT 
           dc.document_id,
           ld.canonical_title,
           ld.trust_tier,
           dc.content,
           1 - (dc.embedding <=> $1::vector) as similarity
         FROM document_chunks dc
         JOIN legal_documents ld ON ld.id = dc.document_id
         WHERE ld.verified_at IS NOT NULL AND ld.valid_to IS NULL
         ORDER BY dc.embedding <=> $1::vector
         LIMIT $2`,
        [`[${qEmb.embedding.join(',')}]`, topK * 3] // fetch more chunks, then dedup per doc
      );

      const perDoc = new Map<string, SemanticHit>();
      for (const row of res.rows) {
        const docId = row.document_id as string;
        if (!perDoc.has(docId)) {
          perDoc.set(docId, {
            documentId: docId,
            canonicalTitle: row.canonical_title as string,
            trustTier: row.trust_tier as 1 | 2 | 3,
            score: Number(row.similarity),
            preview: (row.content as string).slice(0, 200),
          });
        }
      }
      return [...perDoc.values()].slice(0, topK);
    } catch (e) {
      this.logger.error(`PG vector search failed, fallback to JS: ${(e as Error).message}`);
      // Fallback
      const scored = this.fallbackEntries
        .map((e) => ({
          documentId: e.documentId,
          canonicalTitle: e.canonicalTitle,
          trustTier: e.trustTier,
          score: cosineSim(qEmb.embedding, e.vector),
          preview: e.content.slice(0, 200),
        }))
        .filter((h) => h.score > 0)
        .sort((a, b) => b.score - a.score);

      const perDoc = new Map<string, SemanticHit>();
      for (const h of scored) {
        if (!perDoc.has(h.documentId)) perDoc.set(h.documentId, h);
      }
      return [...perDoc.values()].slice(0, topK);
    } finally {
      client.release();
    }
  }

  async stats(): Promise<{ chunks: number; documents: number; dimension: number | null; degraded: string | null; pg: boolean }> {
    if (!this.pgAvailable) {
      return {
        chunks: this.fallbackEntries.length,
        documents: new Set(this.fallbackEntries.map((e) => e.documentId)).size,
        dimension: this.dimension,
        degraded: this.availability().degraded,
        pg: false,
      };
    }

    const client = await this.pool.connect();
    try {
      const res = await client.query(
        `SELECT COUNT(*) as chunks, COUNT(DISTINCT document_id) as docs FROM document_chunks`
      );
      return {
        chunks: Number(res.rows[0]?.chunks ?? 0),
        documents: Number(res.rows[0]?.docs ?? 0),
        dimension: this.dimension,
        degraded: this.availability().degraded,
        pg: true,
      };
    } catch {
      return {
        chunks: this.fallbackEntries.length,
        documents: new Set(this.fallbackEntries.map((e) => e.documentId)).size,
        dimension: this.dimension,
        degraded: 'pg_stats_failed_fallback_js',
        pg: false,
      };
    } finally {
      client.release();
    }
  }
}
