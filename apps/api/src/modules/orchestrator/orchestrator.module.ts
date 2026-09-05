import { Module } from '@nestjs/common';
import { OrchestratorController } from './orchestrator.controller';
import { OrchestratorService } from './orchestrator.service';
import { ExpertRegistry } from './expert-registry';
import { IntentClassifier } from './intent-classifier';
import { AgentsBootstrap } from './agents.bootstrap';
import { AuditModule } from '../audit/audit.module';

/**
 * Orchestrator module (SPEC §11a pillar 3, ADR-000).
 *
 * Phase 0: deterministic routing only, no DB, no AI calls — by design there
 * is no DatabaseModule import here. Agent registration happens via
 * `AgentsBootstrap` so every expert lands in one registry and duplicate ids
 * fail fast at startup, not at first user query.
 */
@Module({
  imports: [AuditModule],
  controllers: [OrchestratorController],
  providers: [OrchestratorService, ExpertRegistry, IntentClassifier, AgentsBootstrap],
  exports: [OrchestratorService, ExpertRegistry],
})
export class OrchestratorModule {}
