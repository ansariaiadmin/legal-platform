import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate' with { 'resolution-mode': 'import' };

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Semantic index storage for the RAG pipeline (pgvector).
 *
 * The corpus itself lives in the storage provider, so this table is
 * self-contained: it carries the title and trust tier it needs for ranking
 * and has no foreign key into `legal_documents` (which the corpus does not
 * populate). The index is rebuilt as a whole, so rows are replaced in one
 * transaction.
 *
 * `embedding` is declared without a fixed dimension so any embedding model
 * works; `dimension` records the model's size and search filters on it.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS vector;');
  pgm.sql(`
    CREATE TABLE rag_chunks (
      chunk_id        text PRIMARY KEY,
      document_id     text NOT NULL,
      canonical_title text NOT NULL,
      trust_tier      smallint NOT NULL CHECK (trust_tier BETWEEN 1 AND 3),
      position        integer NOT NULL,
      content         text NOT NULL,
      dimension       integer NOT NULL,
      embedding       vector NOT NULL,
      indexed_at      timestamptz NOT NULL DEFAULT now()
    );
  `);
  pgm.sql('CREATE INDEX rag_chunks_document_idx ON rag_chunks (document_id);');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('DROP TABLE IF EXISTS rag_chunks;');
}
