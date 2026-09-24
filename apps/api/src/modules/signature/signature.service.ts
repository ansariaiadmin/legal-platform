import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID, createHash, createSign, createVerify } from 'node:crypto';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';

/**
 * E-Signature Service — امضای الکترونیک — v3.2.0 — تاریکی روشن شد
 * 
 * وکیل واقعی نیاز داره پیش‌نویس رو امضا کنه — ماده ۶۵۵ قانون مدنی + قانون تجارت الکترونیکی
 * این ماژول امضای ساده با کلید خصوصی/عمومی + هش SHA256 + زمان‌مهر + IP + audit log
 * 
 * برای production باید با مرکز میانی (CA) مثل کانون سردفتران یا نماد اعتماد وصل بشه
 * ولی برای self-hosted، کلید خود وکیل کافیه — مثل PGP — وکیل کلیدش رو خودش نگه می‌داره
 * 
 * Features:
 * - Generate keypair for lawyer (RSA 2048)
 * - Sign draft/document with private key
 * - Verify signature with public key
 * - Timestamp + IP + user agent
 * - Audit trail
 * - Revocation list
 */

export interface SignatureRecord {
  signatureId: string;
  documentId: string;
  documentHash: string;
  signerId: string;
  signerName: string;
  signature: string; // base64
  publicKey: string; // PEM
  signedAt: string;
  ip: string;
  userAgent: string;
  verified: boolean;
  revokedAt?: string;
  revokedReason?: string;
}

export interface KeyPairRecord {
  userId: string;
  publicKey: string;
  privateKeyEncrypted: string; // encrypted with user's password
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
}

const SIGNATURES_KEY = 'runtime/signatures/signatures.json';
const KEYS_KEY = 'runtime/signatures/keys.json';

@Injectable()
export class SignatureService {
  private readonly logger = new Logger(SignatureService.name);
  private signatures = new Map<string, SignatureRecord>();
  private keys = new Map<string, KeyPairRecord>();
  private loaded = false;

  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.storage.get(SIGNATURES_KEY);
      const parsed = JSON.parse(raw.toString('utf8')) as SignatureRecord[];
      for (const s of parsed) this.signatures.set(s.signatureId, s);
    } catch {
      // empty
    }
    try {
      const rawKeys = await this.storage.get(KEYS_KEY);
      const parsedKeys = JSON.parse(rawKeys.toString('utf8')) as KeyPairRecord[];
      for (const k of parsedKeys) this.keys.set(k.userId, k);
    } catch {
      // empty
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await Promise.all([
      this.storage.put({
        key: SIGNATURES_KEY,
        content: Buffer.from(JSON.stringify([...this.signatures.values()])),
        contentType: 'application/json',
        metadata: { kind: 'signatures' },
      }),
      this.storage.put({
        key: KEYS_KEY,
        content: Buffer.from(JSON.stringify([...this.keys.values()])),
        contentType: 'application/json',
        metadata: { kind: 'signature-keys' },
      }),
    ]);
  }

  /** Generate RSA keypair for lawyer — private key encrypted with password */
  async generateKeyPair(userId: string, password: string): Promise<{ publicKey: string; keyId: string }> {
    await this.ensureLoaded();
    
    const { generateKeyPairSync } = await import('node:crypto');
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: password },
    });

    const record: KeyPairRecord = {
      userId,
      publicKey,
      privateKeyEncrypted: privateKey,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(), // 1 year
      revoked: false,
    };

    this.keys.set(userId, record);
    await this.persist();
    this.logger.log(`keypair generated for user ${userId}`);

    return { publicKey, keyId: userId };
  }

  /** Sign a document/draft — returns signature record */
  async sign(input: {
    documentId: string;
    documentContent: string;
    signerId: string;
    signerName: string;
    privateKey: string;
    password: string;
    ip: string;
    userAgent: string;
  }): Promise<SignatureRecord> {
    await this.ensureLoaded();

    const documentHash = createHash('sha256').update(input.documentContent, 'utf8').digest('hex');
    
    try {
      const sign = createSign('SHA256');
      sign.update(documentHash);
      sign.end();
      const signature = sign.sign({ key: input.privateKey, passphrase: input.password }, 'base64');

      const keyRecord = this.keys.get(input.signerId);
      if (!keyRecord) {
        throw new BadRequestException({ code: 'KEY_NOT_FOUND', message: 'کلید امضای شما یافت نشد — ابتدا کلید بسازید' });
      }

      const record: SignatureRecord = {
        signatureId: randomUUID(),
        documentId: input.documentId,
        documentHash,
        signerId: input.signerId,
        signerName: input.signerName,
        signature,
        publicKey: keyRecord.publicKey,
        signedAt: new Date().toISOString(),
        ip: input.ip,
        userAgent: input.userAgent,
        verified: true,
      };

      this.signatures.set(record.signatureId, record);
      await this.persist();
      this.logger.log(`document ${input.documentId} signed by ${input.signerId}`);

      return record;
    } catch (e) {
      throw new BadRequestException({ code: 'SIGN_FAILED', message: `امضا ناموفق: ${(e as Error).message}` });
    }
  }

  /** Verify a signature */
  async verify(signatureId: string, documentContent: string): Promise<{ valid: boolean; record?: SignatureRecord; reason?: string }> {
    await this.ensureLoaded();
    const record = this.signatures.get(signatureId);
    if (!record) return { valid: false, reason: 'امضا یافت نشد' };
    if (record.revokedAt) return { valid: false, reason: `امضا باطل شده: ${record.revokedReason}`, record };

    const documentHash = createHash('sha256').update(documentContent, 'utf8').digest('hex');
    if (documentHash !== record.documentHash) {
      return { valid: false, reason: 'محتوای سند تغییر کرده — هش مطابقت ندارد', record };
    }

    try {
      const verify = createVerify('SHA256');
      verify.update(documentHash);
      verify.end();
      const valid = verify.verify(record.publicKey, record.signature, 'base64');
      return { valid, record, reason: valid ? undefined : 'امضا نامعتبر — کلید عمومی مطابقت ندارد' };
    } catch (e) {
      return { valid: false, reason: `خطای تایید: ${(e as Error).message}`, record };
    }
  }

  /** List signatures for a document */
  async listForDocument(documentId: string): Promise<SignatureRecord[]> {
    await this.ensureLoaded();
    return [...this.signatures.values()].filter(s => s.documentId === documentId);
  }

  /** List signatures by signer */
  async listBySigner(signerId: string): Promise<SignatureRecord[]> {
    await this.ensureLoaded();
    return [...this.signatures.values()].filter(s => s.signerId === signerId);
  }

  /** Revoke a signature (e.g., if private key compromised) */
  async revoke(signatureId: string, reason: string): Promise<SignatureRecord> {
    await this.ensureLoaded();
    const record = this.signatures.get(signatureId);
    if (!record) throw new BadRequestException({ code: 'SIGNATURE_NOT_FOUND', message: 'امضا یافت نشد' });
    
    record.revokedAt = new Date().toISOString();
    record.revokedReason = reason;
    record.verified = false;
    
    await this.persist();
    this.logger.log(`signature ${signatureId} revoked: ${reason}`);
    return record;
  }

  /** Get public key for a user */
  async getPublicKey(userId: string): Promise<{ publicKey: string; createdAt: string; expiresAt: string } | null> {
    await this.ensureLoaded();
    const key = this.keys.get(userId);
    if (!key || key.revoked) return null;
    return { publicKey: key.publicKey, createdAt: key.createdAt, expiresAt: key.expiresAt };
  }

  stats(): { totalSignatures: number; totalKeys: number } {
    return { totalSignatures: this.signatures.size, totalKeys: this.keys.size };
  }
}
