import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { ERROR_CODES } from '@legal-platform/contracts';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';

export const BACKUP_SCHEMA_VERSION = 1;

export interface BackupBundle {
  schemaVersion: number;
  producedAt: string;
  /** keys under runtime/ and org state, base64-encoded payloads */
  keys: Record<string, string>;
  keyCount: number;
  /** honest scope note — surfaced to UI, never hidden in fine print */
  scope: string;
}

export interface RestoreResult {
  restored: string[];
  skipped: Array<{ key: string; reason: string }>;
}

/**
 * P7: portable backup/restore of ALL StorageProvider-backed state (drafts,
 * machine tokens, brain config, deployment profile, usage rollups, security
 * reports, …). Postgres-resident rows are out of scope BY DESIGN — the
 * bundle says so in `scope` so an operator can't mistake it for a full-DB
 * dump (honesty invariant; ADR-022).
 *
 * Restore is conservative: wrong schemaVersion is rejected outright; a key
 * whose JSON fails to parse is skipped and reported, never half-written.
 */
@Injectable()
export class BackupService {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  async createBundle(options?: { prefix?: string }): Promise<BackupBundle> {
    const prefix = options?.prefix ?? '';

    // StorageListResult.objects: {key, ...}[]; collect all pages
    const collected: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.storage.list({ prefix, cursor, limit: 1000 });
      for (const o of page.objects) collected.push(o.key);
      cursor = page.hasMore ? page.nextCursor : undefined;
    } while (cursor);
    const list = collected;
    const out: Record<string, string> = {};
    for (const key of list) {
      try {
        const buf = await this.storage.get(key);
        out[key] = buf.toString('base64');
      } catch {
        // key vanished between list and get — skip it, bundle stays coherent
      }
    }
    return {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      producedAt: new Date().toISOString(),
      keys: out,
      keyCount: Object.keys(out).length,
      scope:
        'StorageProvider-backed runtime state ONLY. Database tables (SQL) are NOT included — ' +
        'take a pg_dump for those. Backup integrity is structural; it is NOT an encrypted vault: ' +
        'protect the file like a secret.',
    };
  }

  async restore(bundle: unknown): Promise<RestoreResult> {
    if (typeof bundle !== 'object' || bundle === null) {
      throw new BadRequestException(ERROR_CODES.VALIDATION_INVALID_INPUT);
    }
    const b = bundle as Partial<BackupBundle>;
    if (b.schemaVersion !== BACKUP_SCHEMA_VERSION) {
      const err = new Error(`schema ${String(b.schemaVersion)} not supported; expected ${BACKUP_SCHEMA_VERSION}`);
      (err as Error & { code?: string }).code = ERROR_CODES.VALIDATION_INVALID_INPUT;
      throw err;
    }
    if (typeof b.keys !== 'object' || b.keys === null) {
      throw new BadRequestException(ERROR_CODES.VALIDATION_INVALID_INPUT);
    }
    const restored: string[] = [];
    const skipped: Array<{ key: string; reason: string }> = [];
    for (const [key, b64] of Object.entries(b.keys)) {
      if (typeof b64 !== 'string') {
        skipped.push({ key, reason: 'not-a-string' });
        continue;
      }
      let buf: Buffer;
      try {
        buf = Buffer.from(b64, 'base64');
        if (buf.length === 0 && b64.length > 0) throw new Error('empty decode');
      } catch {
        skipped.push({ key, reason: 'base64-decode-failed' });
        continue;
      }
      // JSON-typed keys must parse — a corrupt JSON would poison every lazy loader
      if (key.endsWith('.json')) {
        try {
          JSON.parse(buf.toString('utf8'));
        } catch {
          skipped.push({ key, reason: 'json-parse-failed' });
          continue;
        }
      }
      await this.storage.put({ key, content: buf, contentType: 'application/octet-stream' });
      restored.push(key);
    }
    return { restored, skipped };
  }
}

