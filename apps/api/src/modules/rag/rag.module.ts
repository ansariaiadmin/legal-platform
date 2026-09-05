import { Module, forwardRef } from '@nestjs/common';
import { CorpusModule } from '../corpus/corpus.module';
import { EmbeddingIndexService } from './embedding-index.service';
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
 */
@Module({
  imports: [forwardRef(() => CorpusModule)],
  controllers: [RagController],
  providers: [EmbeddingIndexService, RerankerService, DraftingService, UsageMeterService],
  exports: [EmbeddingIndexService, RerankerService, DraftingService, UsageMeterService],
})
export class RagModule {}
