import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { civilExpert } from '@legal-platform/agent-civil-expert';
import { criminalExpert } from '@legal-platform/agent-criminal-expert';
import { familyExpert } from '@legal-platform/agent-family-expert';
import { registrationExpert } from '@legal-platform/agent-registration-expert';
import { internationalExpert } from '@legal-platform/agent-international-expert';
import { ExpertRegistry } from './expert-registry';

/**
 * Static expert registration at boot (SPEC §11a, ADR-002).
 *
 * Only production experts register here. `legal-expert-base` is the
 * reference template for building new experts; it does not produce answers,
 * so it never joins the live fleet.
 * Registry throws on duplicate ids: wiring mistakes fail the API at startup.
 */
@Injectable()
export class AgentsBootstrap implements OnModuleInit {
  private readonly logger = new Logger(AgentsBootstrap.name);

  constructor(private readonly registry: ExpertRegistry) {}

  onModuleInit(): void {
    for (const expert of [
        civilExpert,
        criminalExpert,
        familyExpert,
        registrationExpert,
        internationalExpert,
      ]) {
      this.registry.register(expert);
    }
    this.logger.log(`registered ${this.registry.list().length} expert agent(s)`);
  }
}
