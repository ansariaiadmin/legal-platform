import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { LegalExpertBaseAgent } from '@legal-platform/agent-legal-expert-base';
import { civilExpert } from '@legal-platform/agent-civil-expert';
import { criminalExpert } from '@legal-platform/agent-criminal-expert';
import { familyExpert } from '@legal-platform/agent-family-expert';
import { registrationExpert } from '@legal-platform/agent-registration-expert';
import { ExpertRegistry } from './expert-registry';

/**
 * Static expert registration at boot (SPEC §11a, ADR-002).
 *
 * General fallback (`legal-expert-base`) registers LAST so field-specialized
 * experts always win equal-score comparisons (first-best-wins order).
 * Registry throws on duplicate ids: wiring mistakes fail the API at startup.
 */
@Injectable()
export class AgentsBootstrap implements OnModuleInit {
  private readonly logger = new Logger(AgentsBootstrap.name);

  constructor(private readonly registry: ExpertRegistry) {}

  onModuleInit(): void {
    for (const expert of [civilExpert, criminalExpert, familyExpert, registrationExpert, new LegalExpertBaseAgent()]) {
      this.registry.register(expert);
    }
    this.logger.log(`registered ${this.registry.list().length} expert agent(s)`);
  }
}
