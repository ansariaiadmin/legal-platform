import { Inject, Injectable, Logger } from '@nestjs/common';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';
import { MachineTokensService, type MachineToken } from '../machine-tokens/machine-tokens.service';

const EPOCHS_KEY = 'runtime/authvault/secret-epochs.json';

interface SecretEpoch {
  key: string; // logical secret class
  lastRotatedAt: string;
  actor: string;
}

export interface RotationAdvice {
  key: string;
  lastRotatedAt: string | null;
  ageDays: number | null;    // null when never
  maxAgeDays: number;
  status: 'fresh' | 'aging' | 'overdue' | 'never';
  hintFa: string;
}

export interface RotateAllResult {
  rotatedAt: string;
  machineTokens: Array<{ label: string; token: string; scopes: string[] }>; // token strings ONLY here, once
  revokedOldCount: number;
  epochs: SecretEpoch[];
  /** the downloadable one-shot credentials file content (plain text) */
  credentialsFile: string;
  notesFa: string[];
}

const ROTATION_POLICY: Array<{ key: string; maxAgeDays: number; hintFa: string }> = [
  { key: 'machine-tokens', maxAgeDays: 180, hintFa: 'توکن‌های ماشین هر ۱۸۰ روز بچرخند' },
  { key: 'area-passwords', maxAgeDays: 90, hintFa: 'رمز قفل‌های حیاتی هر ۹۰ روز عوض شود' },
  { key: 'jwt-secrets', maxAgeDays: 365, hintFa: 'کلیدهای JWT سالانه از env چرخانده شوند (خارج از API — خودتان)' },
  { key: 'webhook-signing', maxAgeDays: 180, hintFa: 'امضای وب‌هوک‌ها را نیز شامل چرخه کنید' },
];

/**
 * P8-T3 the panel's little security robot: watches secret ages, nags
 * honestly, and on ONE button rotates everything the platform OWNS — machine
 * tokens get fresh values (old die by revoke), area-lock epochs bump (old
 * tickets die), and a one-shot credentials file is produced for the owner to
 * download and put in a safe. What the platform does NOT own (env JWT
 * secrets) is stated in the notes instead of pretending we rotated it.
 */
@Injectable()
export class RotationService {
  private readonly logger = new Logger(RotationService.name);
  private epochs = new Map<string, SecretEpoch>();
  private loaded = false;

  constructor(
    private readonly machineTokens: MachineTokensService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private async ensure(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.storage.get(EPOCHS_KEY);
      for (const e of JSON.parse(raw.toString('utf8')) as SecretEpoch[]) this.epochs.set(e.key, e);
    } catch { /* fresh vault */ }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.storage.put({
      key: EPOCHS_KEY,
      content: Buffer.from(JSON.stringify([...this.epochs.values()])),
      contentType: 'application/json',
    });
  }

  /** HONEST staleness report the vault panel renders as a reminder bot. */
  async advice(): Promise<RotationAdvice[]> {
    await this.ensure();
    const tokens = await this.machineTokens.list();
    const live = tokens.filter((t) => t.revokedAt === null);
    const oldestTokenAt = live.length
      ? live.map((t) => Date.parse(t.createdAt)).reduce((a, b) => Math.min(a, b))
      : null;

    return ROTATION_POLICY.map((policy) => {
      const epoch = this.epochs.get(policy.key);
      let lastRotatedAt = epoch?.lastRotatedAt ?? null;
      // inference from reality: machine-token age from actual token records,
      // not just our epoch log
      if (policy.key === 'machine-tokens' && oldestTokenAt !== null) {
        const inferred = new Date(oldestTokenAt).toISOString();
        if (!lastRotatedAt || inferred < lastRotatedAt) lastRotatedAt = inferred;
      }
      const ageDays = lastRotatedAt === null
        ? null
        : Math.floor((Date.now() - Date.parse(lastRotatedAt)) / 86_400_000);
      const status: RotationAdvice['status'] =
        ageDays === null ? 'never'
          : ageDays <= policy.maxAgeDays * 2 / 3 ? 'fresh'
            : ageDays <= policy.maxAgeDays ? 'aging'
              : 'overdue';
      return { key: policy.key, lastRotatedAt, ageDays, maxAgeDays: policy.maxAgeDays, status, hintFa: policy.hintFa };
    });
  }

  async rotateAll(actorId: string): Promise<RotateAllResult> {
    const tokens = await this.machineTokens.list();
    const live = tokens.filter((t) => t.revokedAt === null);

    // rotate each machine token: revoke old, issue fresh with SAME scope+label
    const minted: RotateAllResult['machineTokens'] = [];
    for (const t of live) {
      await this.machineTokens.revoke(t.tokenId, `rotation-by-${actorId}`);
      const days = remainingDays(t);
      const issued = await this.machineTokens.issue({
        label: t.label,
        scopes: t.scopes,
        createdBy: actorId,
        expiresInDays: days > 0 ? days : 30,
      });
      minted.push({ label: t.label, token: issued.token, scopes: issued.record.scopes });
    }

    const now = new Date().toISOString();
    for (const key of ['machine-tokens', 'area-passwords', 'webhook-signing']) {
      this.epochs.set(key, { key, lastRotatedAt: now, actor: actorId });
    }
    await this.persist();
    this.logger.log(`rotate-all: ${live.length} machine token(s) re-issued by ${actorId}`);

    const notesFa = [
      'رمزهای env (JWT_ACCESS_SECRET/JWT_REFRESH_SECRET/ENCRYPTION_MASTER_KEY) را از فایل env سرور تغییر دهید — API هرگز به آنها دست نمی‌زند.',
      'رمز قفل‌های ناحیه‌ای (config/vault/ops) را دستی عوض کنید — امنیت آن در دانستن رمز قدیمی است.',
      'این فایل را یک‌بار دانلود و در جای امن بگذارید؛ پلتفرم از آن نگهداری نمی‌کند.',
    ];

    const credentialsFile = [
      '=== Legal Platform — rotated credentials (ONE-TIME export) ===',
      `rotatedAt: ${now}`,
      `by: ${actorId}`,
      '',
      ...minted.flatMap((m) => [`[machine-token] label=${m.label}`, `token: ${m.token}`, `scopes: ${m.scopes.join(',')}`, '']),
      '--- notes ---',
      ...notesFa,
    ].join('\n');

    return {
      rotatedAt: now,
      machineTokens: minted,
      revokedOldCount: live.length,
      epochs: [...this.epochs.values()],
      credentialsFile,
      notesFa,
    };
  }
}

function remainingDays(t: MachineToken): number {
  if (!t.expiresAt) return 365;
  return Math.max(1, Math.ceil((Date.parse(t.expiresAt) - Date.now()) / 86_400_000));
}
