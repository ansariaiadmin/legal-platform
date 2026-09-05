import { Module, forwardRef } from '@nestjs/common';
import { OrchestratorController } from './orchestrator.controller';
import { OrchestratorService } from './orchestrator.service';
import { ExpertRegistry } from './expert-registry';
import { IntentClassifier } from './intent-classifier';
import { AgentsBootstrap } from './agents.bootstrap';
import { HybridInferenceRouter } from './hybrid-inference-router';
import { AgentGovernanceService } from './agent-governance.service';
import { InProcessAgentEventBus } from './agent-event-bus';
import { LeaderVoiceService } from './leader-voice.service';
import { MetricsAggregatorService } from './metrics-aggregator.service';
import { EvaluatorService } from './evaluator.service';
import { EvolutionService } from './evolution.service';
import { ModelAssignmentService } from './model-assignment.service';
import { PythonWorkerService } from './python-worker.service';
import { FileIntelligenceService } from './file-intelligence.service';
import { PlacementService } from './placement.service';
import { LeaderConversationService } from './leader-conversation.service';
import { ConfigHubService } from './config-hub.service';
import { LlmTiebreakerService } from './llm-tiebreaker.service';
import { BudgetGateService } from './budget-gate.service';
import { SessionMemoryService } from './session-memory.service';
import { ConfigHubController } from './config-hub.controller';
import { AuditModule } from '../audit/audit.module';
import { CorpusModule } from '../corpus/corpus.module';

@Module({
  imports: [AuditModule, forwardRef(() => CorpusModule)],
  controllers: [OrchestratorController, ConfigHubController],
  providers: [
    OrchestratorService,
    ExpertRegistry,
    IntentClassifier,
    AgentsBootstrap,
    HybridInferenceRouter,
    AgentGovernanceService,
    InProcessAgentEventBus,
    LeaderVoiceService,
    MetricsAggregatorService,
    EvaluatorService,
    EvolutionService,
    ModelAssignmentService,
    PythonWorkerService,
    FileIntelligenceService,
    PlacementService,
    LeaderConversationService,
    ConfigHubService,
    LlmTiebreakerService,
    BudgetGateService,
    SessionMemoryService,
  ],
  exports: [
    OrchestratorService,
    ExpertRegistry,
    AgentGovernanceService,
    InProcessAgentEventBus,
    EvolutionService,
    MetricsAggregatorService,
    ModelAssignmentService,
    PythonWorkerService,
    FileIntelligenceService,
    LeaderConversationService,
    ConfigHubService,
    LlmTiebreakerService,
    BudgetGateService,
    SessionMemoryService,
  ],
})
export class OrchestratorModule {}
