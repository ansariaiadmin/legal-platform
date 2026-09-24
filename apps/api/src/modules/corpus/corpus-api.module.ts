import { Module } from '@nestjs/common';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { CorpusModule } from './corpus.module';
import { CorpusController } from './corpus.controller';

/**
 * Composition seam (P2-T5): the dashboard controller sits ABOVE the leafs —
 * corpus services (shelf) + orchestrator's FileIntelligenceService (uploads)
 * meet only here, keeping both modules acyclic.
 */
@Module({
  imports: [CorpusModule, OrchestratorModule],
  controllers: [CorpusController],
})
export class CorpusApiModule {}
