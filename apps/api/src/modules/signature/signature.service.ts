import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID, createHash, createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';

/**
 * Document signatures for drafts and documents (RSA-2048 over SHA-256).
 *
 * Each lawyer holds a key pair; a signature records the document hash, the
 * signer, a timestamp, the client IP and user agent, and is kept in an audit
 * trail with a revocation list.
 *
 * Legal status: this proves integrity and who signed inside this system. It
 * is not a "secure electronic signature" (امضای الکترونیکی مطمئن) under the
 * Iranian Electronic Commerce Act of 1382 (قانون تجارت الکترونیکی), which
 * requires a certificate issued by a licensed certification authority. Use
 * a licensed provider when that level of evidence is required.
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
  privateKeyEncrypted: string; // PKCS#8 PEM, encrypted with the key password
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
}

const SIGNATURES_KEY = 'runtime/signatures/signatures.json';
const KEYS_KEY = 'runtime/signatures/keys.json';
const KEY_LIFETIME_MS = 365 * 24 * 3600 * 1000;

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

  /**
   * Generate an RSA-2048 key pair for a lawyer. The private key never leaves
   * the server: it is stored PKCS#8-encrypted (AES-256-CBC) under the
   * lawyer's key password, which is not stored anywhere.
   */
  async generateKeyPair(userId: string, password: string): Promise<{ publicKey: string; keyId: string; expiresAt: string }> {
    await this.ensureLoaded();

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
      expiresAt: new Date(Date.now() + KEY_LIFETIME_MS).toISOString(),
      revoked: false,
    };

    this.keys.set(userId, record);
    await this.persist();
    this.logger.log(`key pair generated for user ${userId}`);

    return { publicKey, keyId: userId, expiresAt: record.expiresAt };
  }

  /**
   * Sign a document with the signer's stored key. The key password unlocks
   * the encrypted private key for this operation only.
   */
  async sign(input: {
    documentId: string;
    documentContent: string;
    signerId: string;
    signerName: string;
    password: string;
    ip: string;
    userAgent: string;
  }): Promise<SignatureRecord> {
    await this.ensureLoaded();

    const keyRecord = this.keys.get(input.signerId);
    if (!keyRecord || keyRecord.revoked) {
      throw new BadRequestException({ code: 'KEY_NOT_FOUND', message: 'کلید امضای شما یافت نشد. ابتدا کلید بسازید.' });
    }
    if (Date.parse(keyRecord.expiresAt) <= Date.now()) {
      throw new BadRequestException({ code: 'KEY_EXPIRED', message: 'کلید امضای شما منقضی شده است. کلید تازه بسازید.' });
    }

    const documentHash = createHash('sha256').update(input.documentContent, 'utf8').digest('hex');

    let signature: string;
    try {
      const signer = createSign('SHA256');
      signer.update(documentHash);
      signer.end();
      signature = signer.sign({ key: keyRecord.privateKeyEncrypted, passphrase: input.password }, 'base64');
    } catch {
      // A wrong password is the only realistic cause: the key itself was
      // produced by generateKeyPair().
      throw new BadRequestException({ code: 'WRONG_KEY_PASSWORD', message: 'رمز کلید امضا نادرست است.' });
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
  }

  /** Verify a signature */
  async verify(signatureId: string, documentContent: string): Promise<{ valid: boolean; record?: SignatureRecord; reason?: string }> {
    await this.ensureLoaded();
    const record = this.signatures.get(signatureId);
    if (!record) return { valid: false, reason: 'امضا یافت نشد.' };
    if (record.revokedAt) return { valid: false, reason: `امضا باطل شده است: ${record.revokedReason}`, record };

    const documentHash = createHash('sha256').update(documentContent, 'utf8').digest('hex');
    if (documentHash !== record.documentHash) {
      return { valid: false, reason: 'محتوای سند پس از امضا تغییر کرده است.', record };
    }

    try {
      const verify = createVerify('SHA256');
      verify.update(documentHash);
      verify.end();
      const valid = verify.verify(record.publicKey, record.signature, 'base64');
      return { valid, record, reason: valid ? undefined : 'امضا با کلید عمومی امضاکننده مطابقت ندارد.' };
    } catch (e) {
      return { valid: false, reason: `خطا در بررسی امضا: ${(e as Error).message}`, record };
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
    if (!record) throw new BadRequestException({ code: 'SIGNATURE_NOT_FOUND', message: 'امضا یافت نشد.' });
    
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

  async stats(): Promise<{ totalSignatures: number; totalKeys: number }> {
    await this.ensureLoaded();
    return { totalSignatures: this.signatures.size, totalKeys: this.keys.size };
  }
}
