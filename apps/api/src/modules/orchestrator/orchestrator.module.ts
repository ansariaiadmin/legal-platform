import { Module } from '@nestjs/common';
import { OrchestratorController } from './orchestrator.controller';
import { OrchestratorService } from './orchestrator.service';
import { ExpertRegistry } from './expert-registry';
import { IntentClassifier } from './intent-classifier';
import { AgentsBootstrap } from './agents.bootstrap';
import { HybridInferenceRouter } from './hybrid-inference-router';
import { AgentGovernanceService } from './agent-governance.service';
import { InProcessAgentEventBus } from './agent-event-bus';
import { LeaderVoiceService } from './leader-voice.service';
import { AuditModule } from '../audit/audit.module';

/**
 * Orchestrator module (SPEC §11a pillar 3, ADR-000..006).
 *
 * Wiring notes:
 * - No DatabaseModule here on purpose (in-memory grant/event stores until the
 *   Phase-5 governance migration lands; a process restart = full revoke, which
 *   is the fail-safe direction).
 * - AI_PROVIDER comes from the global ProviderRegistryModule; the hybrid
 *   router decides local-vs-cloud per task (ADR-004).
 */
@Module({
  imports: [AuditModule],
  controllers: [OrchestratorController],
  providers: [
    OrchestratorService,
    ExpertRegistry,
    IntentClassifier,
    AgentsBootstrap,
    HybridInferenceRouter,
    AgentGovernanceService,
    InProcessAgentEventBus,
    LeaderVoiceService,
  ],
  exports: [OrchestratorService, ExpertRegistry, AgentGovernanceService, InProcessAgentEventBus],
})
export class OrchestratorModule {}
