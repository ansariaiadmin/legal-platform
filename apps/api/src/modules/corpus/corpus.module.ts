import { Module, forwardRef } from '@nestjs/common';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { CorpusService } from './corpus.service';
import { DataValidatorService } from './data-validator.service';
import { LawUpdaterService } from './law-updater.service';

/**
 * P2-T2..T5: the corpus shelf — knowledge sources, documents with trust
 * tiers + temporal validity, the validator tick, the updater supersession,
 * and deterministic grounding search.
 *
 * Derives the live event bus from the orchestrator side so `corpus.ingested`
 * / `corpus.validated` show on the kitchen stream. forwardRef breaks the
 * intentional cycle: orchestrator reads corpus for grounding (P2-T4) while
 * corpus publishes events into the orchestrator's bus (P2-T5).
 */
@Module({
  imports: [forwardRef(() => OrchestratorModule)],
  providers: [CorpusService, DataValidatorService, LawUpdaterService],
  exports: [CorpusService, DataValidatorService, LawUpdaterService],
})
export class CorpusModule {}
