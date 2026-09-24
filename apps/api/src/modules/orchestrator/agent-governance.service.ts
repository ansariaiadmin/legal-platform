import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  AgentGovernance,
  AgentGrant,
  GrantDecision,
  GovernanceCapability,
} from '@legal-platform/shared';

/**
 * Leader's governance desk (ADR-005). Phase 1 store is in-memory per boot —
 * grants die with the process BY DESIGN until the governance table migration
 * (P5-T3) lands; a restart revoking privileges is safe, never the reverse.
 * Every mutation is audit-logged by the controller above this service.
 */
@Injectable()
export class AgentGovernanceService implements AgentGovernance {
  private readonly grants = new Map<string, AgentGrant>();
  private readonly disabledAgents = new Set<string>();

  async grant(
    input: Omit<AgentGrant, 'grantId' | 'issuedAt' | 'revokedAt'>,
  ): Promise<AgentGrant> {
    const grant: AgentGrant = {
      ...input,
      grantId: randomUUID(),
      issuedAt: new Date().toISOString(),
      revokedAt: null,
    };
    this.grants.set(grant.grantId, grant);
    return grant;
  }

  async revoke(grantId: string, _revokedBy: string): Promise<void> {
    const grant = this.grants.get(grantId);
    if (grant && !grant.revokedAt) {
      this.grants.set(grantId, { ...grant, revokedAt: new Date().toISOString() });
    }
  }

  setDisabled(agentId: string, disabled: boolean): void {
    if (disabled) this.disabledAgents.add(agentId);
    else this.disabledAgents.delete(agentId);
  }

  isDisabled(agentId: string): boolean {
    return this.disabledAgents.has(agentId);
  }

  async check(
    agentId: string,
    capability: GovernanceCapability,
    now = new Date(),
  ): Promise<GrantDecision> {
    if (this.disabledAgents.has(agentId)) return { allowed: false, reason: 'disabled' };

    const candidates = [...this.grants.values()].filter(
      (g) =>
        g.agentId === agentId &&
        (g.capability === capability || g.capability === `expert:${wildcardOf(capability)}:execute`),
    );
    const grant = candidates.sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0];
    if (!grant) return { allowed: false, reason: 'no_grant' };
    if (grant.revokedAt) return { allowed: false, reason: 'revoked' };
    if (new Date(grant.expiresAt) <= now) return { allowed: false, reason: 'expired' };
    return { allowed: true, grant };
  }

  async listGrants(agentId?: string): Promise<readonly AgentGrant[]> {
    const all = [...this.grants.values()];
    return agentId ? all.filter((g) => g.agentId === agentId) : all;
  }
}

function wildcardOf(capability: string): string {
  // 'expert:civil:execute' -> 'civil' so a field-level grant covers it.
  return capability.split(':')[1] ?? '*';
}
