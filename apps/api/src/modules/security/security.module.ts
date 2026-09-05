import { forwardRef, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { MachineTokensModule } from '../machine-tokens/machine-tokens.module';
import { ExpertRegistry } from '../orchestrator/expert-registry';
import { SecurityAuditService } from './security-audit.service';
import { SecurityGuardianAgent } from './security-guardian.agent';
import { SecuritySchedulerService } from './security-scheduler.service';
import { SecurityController } from './security.controller';

@Injectable()
class SecurityGuardianRegistration implements OnModuleInit {
  private readonly logger = new Logger(SecurityGuardianRegistration.name);

  constructor(
    private readonly registry: ExpertRegistry,
    private readonly guardian: SecurityGuardianAgent,
  ) {}

  onModuleInit(): void {
    // Registration throws on id collision — a wiring bug fails boot,
    // matching AgentsBootstrap semantics.
    this.registry.register(this.guardian);
    this.logger.log(`security guardian registered: ${this.guardian.agentId} (kind=${this.guardian.kind})`);
  }
}

/**
 * Security plane (P6-S3): standards catalog, audit engine, guardian agent,
 * scheduler, dashboard APIs. The guardian registers into the SAME
 * ExpertRegistry the legal experts use — one fleet, one tree, one dashboard;
 * its distinct `kind: 'guardian'` keeps routing semantics honest.
 */
@Module({
  imports: [forwardRef(() => OrchestratorModule), MachineTokensModule],
  controllers: [SecurityController],
  providers: [
    SecurityAuditService,
    SecurityGuardianAgent,
    SecuritySchedulerService,
    SecurityGuardianRegistration,
  ],
  exports: [SecurityAuditService, SecurityGuardianAgent, SecuritySchedulerService],
})
export class SecurityModule {}
