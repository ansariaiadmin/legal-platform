import { Module, forwardRef } from '@nestjs/common';
import { CorpusModule } from '../corpus/corpus.module';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { EmbeddingIndexService } from './embedding-index.service';
import { PgEmbeddingIndexService } from './pg-embedding-index.service';
import { RerankerService } from './reranker.service';
import { DraftingService } from './drafting.service';
import { UsageMeterService } from './usage-meter.service';
import { RagController } from './rag.controller';

/**
 * Phase 4 — the RAG pipeline (SPEC §9):
 *   retrieve (lexical + semantic) → rerank (configured weights) → draft with
 *   citations → await the LAWYER's review.
 * EmbeddingIndexService needs CorpusService (reads the shelf); drafting needs
 * the index + reranker + meter. Both live over the StorageProvider today,
 * pgvector/SQL tomorrow, same contract surface.
 *
 * v3.2.2 — تاریکی روشن شد — pgvector واقعی — PgEmbeddingIndexService با document_chunks.embedding vector(1536) — با <=> cosine distance — IVFFLAT index — برای 100k سند سریع — fallback به JSON اگر PG نیست — سقف
 */
@Module({
  imports: [forwardRef(() => CorpusModule), forwardRef(() => OrchestratorModule)],
  controllers: [RagController],
  providers: [EmbeddingIndexService, PgEmbeddingIndexService, RerankerService, DraftingService, UsageMeterService],
  exports: [EmbeddingIndexService, PgEmbeddingIndexService, RerankerService, DraftingService, UsageMeterService],
})
export class RagModule {}
