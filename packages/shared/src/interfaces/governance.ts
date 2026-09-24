/**
 * Agent governance (SPEC §11a pillar 3, ADR-005): the Leader manages the fleet.
 * Sub-agents may only act inside an active grant's scope. Grants are issued
 * per-skill, expire, and are fully audit-logged — `secure access` is explicit,
 * never implicit ambient authority.
 */

/** What a grant authorizes. Namespaced: `<domain>:<action>[:<target>]`. */
export type GovernanceCapability =
  | 'expert:civil:execute'
  | 'expert:criminal:execute'
  | 'expert:family:execute'
  | 'expert:registration:execute'
  | 'expert:general:execute'
  | 'collector:official:ingest'
  | 'validator:corpus:verify'
  | 'updater:corpus:version'
  | 'voice:leader:session'
  | `expert:${string}:execute`
  | (string & {});

export interface AgentGrant {
  grantId: string;
  agentId: string;
  capability: GovernanceCapability;
  /** who authorized — dashboard user id; recorded in audit_logs */
  grantedBy: string;
  issuedAt: string; // ISO
  expiresAt: string; // ISO; grants are never permanent
  /** fine-grained constraints, e.g. { maxTokensPerTask: 2000 } */
  constraints?: Record<string, unknown>;
  revokedAt?: string | null;
}

export type GrantDecision =
  | { allowed: true; grant: AgentGrant }
  | { allowed: false; reason: 'no_grant' | 'expired' | 'revoked' | 'disabled' };

/** Port the governance service implements; orchestrator checks before dispatch. */
export interface AgentGovernance {
  grant(
    input: Omit<AgentGrant, 'grantId' | 'issuedAt' | 'revokedAt'>,
  ): Promise<AgentGrant>;
  revoke(grantId: string, revokedBy: string): Promise<void>;
  /** The pre-dispatch gate every governed agent call must pass. */
  check(agentId: string, capability: GovernanceCapability, now?: Date): Promise<GrantDecision>;
  listGrants(agentId?: string): Promise<readonly AgentGrant[]>;
}
