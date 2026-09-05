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
import { MetricsAggregatorService } from './metrics-aggregator.service';
import { EvaluatorService } from './evaluator.service';
import { EvolutionService } from './evolution.service';
import { ModelAssignmentService } from './model-assignment.service';
import { PythonWorkerService } from './python-worker.service';
import { AuditModule } from '../audit/audit.module';

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
    MetricsAggregatorService,
    EvaluatorService,
    EvolutionService,
    ModelAssignmentService,
    PythonWorkerService,
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
  ],
})
export class OrchestratorModule {}
