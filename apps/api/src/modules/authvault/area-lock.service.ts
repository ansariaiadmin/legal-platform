import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@legal-platform/contracts';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';
import { RateLimitService } from '../../common/rate-limit.service';

/**
 * P8-T2 area locks — a SECOND, independent layer for the sensitive surfaces
 * (dashboard config, vault itself, future admin zones). Layered on purpose:
 * the session gate authenticates WHO you are; the area lock re-challenges
 * before you touch dangerous knobs. An org sloppy with its session hygiene
 * still can't lose the vault in one tab (the owner's exact ask).
 *
 * Storage:
 *  - passwords: scrypt hash + per-lock salt (never the plaintext, never env)
 *  - admissions: HMAC-signed tickets `alt_<area>_<id>_<exp>_<sig>` — verifiable
 *    statelessly, revocable per area (bumping the lock epoch invalidates all
 *    outstanding tickets of that area instantly).
 */

export type LockedArea = 'config' | 'vault' | 'ops';
export const LOCKED_AREAS: readonly LockedArea[] = ['config', 'vault', 'ops'] as const;

interface AreaLockRecord {
  area: LockedArea;
  enabled: boolean;
  saltHex: string;
  hashHex: string;
  epoch: number; // bumped whenever password changes → old tickets die
  updatedAt: string;
  updatedBy: string;
}

const KEY = 'runtime/authvault/area-locks.json';
const TICKET_TTL_MS = 12 * 3_600_000;
const MIN_PASSWORD_LEN = 8;

@Injectable()
export class AreaLockService {
  private locks = new Map<LockedArea, AreaLockRecord>();
  private loaded = false;

  constructor(
    private readonly config: ConfigService,
    private readonly rateLimiter: RateLimitService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private async ensure(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.storage.get(KEY);
      for (const l of JSON.parse(raw.toString('utf8')) as AreaLockRecord[]) this.locks.set(l.area, l);
    } catch { /* no locks yet — everything open */ }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.storage.put({
      key: KEY,
      content: Buffer.from(JSON.stringify([...this.locks.values()])),
      contentType: 'application/json',
    });
  }

  async status(): Promise<Array<{ area: LockedArea; locked: boolean; updatedAt: string | null }>> {
    await this.ensure();
    return LOCKED_AREAS.map((area) => ({
      area,
      locked: this.locks.get(area)?.enabled ?? false,
      updatedAt: this.locks.get(area)?.updatedAt ?? null,
    }));
  }

  async setPassword(area: LockedArea, password: string, byUserId: string): Promise<{ area: LockedArea; locked: true }> {
    await this.ensure();
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN) {
      const err = new Error(`area password must be ≥${MIN_PASSWORD_LEN} chars`);
      (err as Error & { code?: string }).code = ERROR_CODES.VALIDATION_INVALID_INPUT;
      throw err;
    }
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 32);
    const prev = this.locks.get(area);
    this.locks.set(area, {
      area,
      enabled: true,
      saltHex: salt.toString('hex'),
      hashHex: hash.toString('hex'),
      epoch: (prev?.epoch ?? 0) + 1, // password change kills old tickets by epoch mismatch
      updatedAt: new Date().toISOString(),
      updatedBy: byUserId,
    });
    await this.persist();
    return { area, locked: true };
  }

  async disable(area: LockedArea, byUserId: string): Promise<{ area: LockedArea; locked: false }> {
    await this.ensure();
    const rec = this.locks.get(area);
    if (rec) {
      rec.enabled = false;
      rec.epoch += 1;
      rec.updatedAt = new Date().toISOString();
      rec.updatedBy = byUserId;
      await this.persist();
    }
    return { area, locked: false };
  }

  /** Correct password → admission ticket. Wrong → 401 with honest rate-limiting. */
  async unlock(area: LockedArea, password: string, clientIp: string): Promise<{ ticket: string; expiresAt: string }> {
    await this.ensure();
    const rec = this.locks.get(area);
    if (!rec?.enabled) {
      const exp = Date.now() + TICKET_TTL_MS;
      return { ticket: this.signTicket(area, exp), expiresAt: new Date(exp).toISOString() };
    }
    const decision = this.rateLimiter.consume(`arealock:${area}:${clientIp}`, {
      limit: 5, windowMs: 60_000, lockMs: 5 * 60_000,
    });
    if (!decision.allowed) {
      throw Object.assign(new Error(`too many attempts; retry in ${decision.retryAfterSeconds}s`), {
        code: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
      });
    }
    const hash = scryptSync(password, Buffer.from(rec.saltHex, 'hex'), 32);
    const ok = timingSafeEqual(hash, Buffer.from(rec.hashHex, 'hex'));
    if (!ok) {
      const err = new Error('wrong area password');
      (err as Error & { code?: string }).code = ERROR_CODES.AUTH_INVALID_CREDENTIALS;
      throw err;
    }
    const exp = Date.now() + TICKET_TTL_MS;
    return { ticket: this.signTicket(area, exp), expiresAt: new Date(exp).toISOString() };
  }

  /** Stateless verify: signature + expiry + epoch must match current lock. */
  async verifyTicket(area: LockedArea, ticket: string | undefined): Promise<boolean> {
    await this.ensure();
    const rec = this.locks.get(area);
    if (!rec?.enabled) return true; // unlocked area = open by design (operator's choice)
    if (!ticket) return false;
    const parts = ticket.split('_'); // alt_<area>_<id>_<exp>_<epoch>_<sig>
    if (parts.length !== 6 || parts[0] !== 'alt' || parts[1] !== area) return false;
    const expStr = parts[3];
    const epochStr = parts[4];
    const sig = parts[5] ?? '';
    const exp = Number(expStr);
    const epoch = Number(epochStr);
    if (!Number.isFinite(exp) || !Number.isFinite(epoch)) return false;
    if (Date.now() > exp) return false;
    if (epoch !== rec.epoch) return false;
    const expected = this.signTicketPayload(area, expStr, epochStr);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private secret(): string {
    return (
      this.config.get<string>('AREA_TICKET_SECRET') ||
      this.config.get<string>('JWT_ACCESS_SECRET') ||
      'dev-area-secret'
    );
  }

  private signTicket(area: LockedArea, exp: number): string {
    const epoch = this.looksEpoch(area);
    const id = randomUUID().slice(0, 8);
    return `alt_${area}_${id}_${exp}_${epoch}_${this.signTicketPayload(area, String(exp), String(epoch))}`;
  }

  private looksEpoch(area: LockedArea): number {
    return this.locks.get(area)?.epoch ?? 0;
  }

  private signTicketPayload(area: LockedArea, exp: string, epoch: string): string {
    return createHmac('sha256', this.secret())
      .update(`${area}|${exp}|${epoch}`)
      .digest('hex')
      .slice(0, 24);
  }
}
