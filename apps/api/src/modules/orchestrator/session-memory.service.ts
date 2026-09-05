import { Inject, Injectable } from '@nestjs/common';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';

/**
 * P3-T3: short-term session memory. The Leader's conversations RESUME after
 * an API restart; turns expire honestly (TTL) — the system never pretends
 * to remember yesterday's whole life, and never claims a turn it didn't see.
 *
 * Storage through the StorageProvider port (`runtime/sessions/<user>.json`),
 * Redis swap behind the same shapes later (mirroring the ingestion worker).
 * Redis TTL was the roadmap's choice; here TTL is evaluated at read time
 * (`expiresAt` field), which survives restarts without any key-lease magic.
 */

export interface MemoryTurn {
  role: 'lawyer' | 'leader';
  text: string;
  at: string;
}

const MAX_TURNS = 10;
const DEFAULT_TTL_MS = 30 * 60 * 1_000;

@Injectable()
export class SessionMemoryService {
  /** read-time TTL (ms); tests override directly — not a Nest ctor dep */
  ttlMs: number = DEFAULT_TTL_MS;

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private key(userId: string): string {
    // user ids are uuid-ish already; no salted hashing here — this is a
    // per-office store behind auth, not a credential vault
    return `runtime/sessions/${userId.replace(/[^\w-]/g, '_')}.json`;
  }

  async remember(userId: string, role: 'lawyer' | 'leader', text: string): Promise<void> {
    const turns = await this.load(userId);
    turns.push({ role, text: text.slice(0, 800), at: new Date().toISOString() });
    const trimmed = turns.slice(-MAX_TURNS);
    await this.storage.put({
      key: this.key(userId),
      content: Buffer.from(JSON.stringify(trimmed)),
      contentType: 'application/json',
      metadata: { kind: 'session-memory' },
    });
  }

  /** Turns belonging to the STILL-VALID window. Empty list = nothing remembered. */
  async recall(userId: string): Promise<MemoryTurn[]> {
    return this.load(userId);
  }

  /** Context lines for the dispatcher — attributed, durable, trimmed. */
  async contextLines(userId: string): Promise<string[]> {
    const turns = await this.recall(userId);
    if (turns.length === 0) return [];
    return turns.map((t) => `[${t.role === 'lawyer' ? 'وکیل' : 'لیدر'}]: ${t.text.slice(0, 200)}`);
  }

  async clear(userId: string): Promise<void> {
    await this.storage.delete(this.key(userId)).catch(() => undefined);
  }

  private async load(userId: string): Promise<MemoryTurn[]> {
    try {
      const raw = await this.storage.get(this.key(userId));
      const all = JSON.parse(raw.toString('utf8')) as MemoryTurn[];
      const cutoff = Date.now() - this.ttlMs;
      return all.filter((t) => Date.parse(t.at) >= cutoff);
    } catch {
      return [];
    }
  }
}
