import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { LegalExpertBaseAgent } from '@legal-platform/agent-legal-expert-base';
import { ExpertRegistry } from './expert-registry';

/**
 * Static expert registration at boot (SPEC §11a, ADR-002).
 *
 * Phase 0/1 pattern: each apps/agents/* package contributes one wiring line
 * here. Registry throws on duplicate ids, so a wiring mistake fails the API
 * at startup — loud and safe, exactly when it should.
 */
@Injectable()
export class AgentsBootstrap implements OnModuleInit {
  private readonly logger = new Logger(AgentsBootstrap.name);

  constructor(private readonly registry: ExpertRegistry) {}

  onModuleInit(): void {
    this.registry.register(new LegalExpertBaseAgent());
    this.logger.log(`registered ${this.registry.list().length} expert agent(s)`);
  }
}
