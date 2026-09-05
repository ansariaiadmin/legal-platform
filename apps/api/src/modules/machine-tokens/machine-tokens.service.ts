import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';

/**
 * P5-T3: machine tokens for external front-ends (mini-apps, scripts). The
 * token is `lpm_<id>_<sig>` where sig = HMAC(secret, id|scopes|expiresAt).
 * Signature math is deterministic, and storage persistence (via
 * StorageProvider) means revocation SURVIVES restarts — a revoked token dies
 * honestly at the gate, not merely in memory (ADR-018's honesty applies to
 * credentials too).
 *
 * Scopes are a closed world: only strings in ALLOWED_SCOPES may be granted.
 */

export type MachineTokenScope =
  | 'client:read'
  | 'client:write'
  | 'drafts:read'
  | 'drafts:write'
  | 'events:stream';

export const ALLOWED_SCOPES: readonly MachineTokenScope[] = [
  'client:read',
  'client:write',
  'drafts:read',
  'drafts:write',
  'events:stream',
] as const;

export interface MachineToken {
  tokenId: string;
  label: string;
  scopes: MachineTokenScope[];
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

interface Store { tokens: MachineToken[] }

const KEY = 'runtime/machine-tokens/store.json';

@Injectable()
export class MachineTokensService {
  private readonly logger = new Logger(MachineTokensService.name);
  private byId = new Map<string, MachineToken>();
  private loaded = false;

  constructor(
    private readonly config: ConfigService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private secret(): string {
    return this.config.get<string>('MACHINE_TOKEN_SECRET')
      ?? this.config.get<string>('JWT_ACCESS_SECRET')
      ?? 'dev-machine-secret-change-in-prod';
  }

  private async ensure(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.storage.get(KEY);
      const parsed = JSON.parse(raw.toString('utf8')) as Store;
      for (const t of parsed.tokens) this.byId.set(t.tokenId, t);
    } catch { /* empty quiver is honest */ }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.storage.put({
      key: KEY,
      content: Buffer.from(JSON.stringify({ tokens: [...this.byId.values()] } satisfies Store)),
      contentType: 'application/json',
      metadata: { kind: 'machine-tokens' },
    });
  }

  private sign(tokenId: string, scopes: MachineTokenScope[], expiresAt: string | null): string {
    return createHmac('sha256', this.secret())
      .update(`${tokenId}|${[...scopes].sort().join(',')}|${expiresAt ?? ''}`)
      .digest('hex')
      .slice(0, 32);
  }

  /** The UI gets the full token ONCE. The store keeps only the hash of its
   *  signature half — leaking the store never mints access. */
  async issue(input: {
    label: string;
    scopes: MachineTokenScope[];
    createdBy: string;
    expiresInDays?: number;
  }): Promise<{ token: string; record: MachineToken }> {
    await this.ensure();
    for (const s of input.scopes) {
      if (!ALLOWED_SCOPES.includes(s)) throw new Error(`unknown scope: ${s}`);
    }
    const tokenId = randomUUID();
    let expiresAt: string | null = null;
    if (input.expiresInDays !== undefined) {
      if (!Number.isFinite(input.expiresInDays)) throw new Error('expiresInDays must be finite');
      // zero/negative = ALREADY dead by policy — valid shape, no invented grace
      expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString();
    }
    const sig = this.sign(tokenId, input.scopes, expiresAt);

    const record: MachineToken = {
      tokenId,
      label: input.label,
      scopes: input.scopes,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      expiresAt,
      revokedAt: null,
      lastUsedAt: null,
    };
    this.byId.set(tokenId, record);
    await this.persist();
    this.logger.log(`machine token issued: ${input.label} scopes=[${input.scopes.join(',')}]`);
    return { token: `lpm_${tokenId}_${sig}`, record };
  }

  /** Deterministic verify: parse → HMAC compare → revoked? expired? → touch. */
  async verify(token: string, requiredScope: MachineTokenScope): Promise<MachineToken | null> {
    await this.ensure();
    const m = token.match(/^lpm_([^_]+)_([0-9a-f]{32})$/);
    if (!m) return null;
    const [, tokenId, sig] = m;
    const record = this.byId.get(tokenId);
    if (!record) return null;
    if (record.revokedAt) return null;
    if (record.expiresAt && Date.parse(record.expiresAt) < Date.now()) return null;
    if (!record.scopes.includes(requiredScope)) return null;

    const expected = this.sign(record.tokenId, record.scopes, record.expiresAt);
    const ok =
      sig.length === expected.length &&
      timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!ok) return null;

    record.lastUsedAt = new Date().toISOString();
    await this.persist();
    return record;
  }

  async revoke(tokenId: string, byUserId: string): Promise<boolean> {
    await this.ensure();
    const t = this.byId.get(tokenId);
    if (!t || t.revokedAt) return false;
    t.revokedAt = new Date().toISOString();
    this.logger.log(`machine token revoked by ${byUserId}: ${t.label}`);
    await this.persist();
    return true;
  }

  async list(): Promise<MachineToken[]> {
    await this.ensure();
    return [...this.byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
