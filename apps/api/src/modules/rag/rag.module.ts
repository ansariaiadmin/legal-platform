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
 * The corpus lives in the storage provider; drafting needs the semantic
 * index, the reranker and the usage meter.
 *
 * Semantic search uses pgvector (table rag_chunks) when available and the
 * JSON index otherwise; see pickSemanticIndex().
 */
@Module({
  imports: [forwardRef(() => CorpusModule), forwardRef(() => OrchestratorModule)],
  controllers: [RagController],
  providers: [EmbeddingIndexService, PgEmbeddingIndexService, RerankerService, DraftingService, UsageMeterService],
  exports: [EmbeddingIndexService, PgEmbeddingIndexService, RerankerService, DraftingService, UsageMeterService],
})
export class RagModule {}
