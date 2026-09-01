import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
/** Wire format is `enc:v1:<iv>:<tag>:<ciphertext>` - five colon-separated parts. */
const ENVELOPE_PARTS = 5;
const KDF_SALT = 'legal-platform.encryption.v1';

/**
 * AES-256-GCM envelope encryption for provider credentials at rest
 * (SPEC section 5 and 8).
 *
 * Accepted key formats: 64 hex characters, or base64 of exactly 32 bytes.
 * `scripts/install.sh` used to emit `openssl rand -hex 32`; base64-decoding
 * that string yields 48 bytes, which the previous strict check rejected - so a
 * freshly installed server could not boot. Both encodings are now accepted and
 * validated.
 *
 * Outside production, any non-conforming value is stretched with scrypt rather
 * than rejected, so development stays usable. Encryption itself is always real.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly masterKey: Buffer;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.get<string>('ENCRYPTION_MASTER_KEY') ?? '';
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';

    if (!raw.trim()) {
      if (isProduction) {
        throw new Error('ENCRYPTION_MASTER_KEY is not configured');
      }
      this.logger.warn(
        'ENCRYPTION_MASTER_KEY is not set - deriving an ephemeral key. Secrets will not decrypt after a restart.',
      );
      this.masterKey = scryptSync(KDF_SALT, KDF_SALT, 32);
      return;
    }

    this.masterKey = this.resolveKey(raw.trim(), isProduction);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Format: enc:v1:<base64 iv>:<base64 tag>:<base64 ciphertext>
    return [
      'enc',
      'v1',
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(envelope: string): string {
    const parts = envelope.split(':');

    if (parts.length !== ENVELOPE_PARTS || parts[0] !== 'enc' || parts[1] !== 'v1') {
      throw new Error('SECURITY_INVALID_ENCRYPTED_FORMAT');
    }

    try {
      const iv = Buffer.from(parts[2], 'base64');
      const tag = Buffer.from(parts[3], 'base64');
      const decipher = createDecipheriv(ALGORITHM, this.masterKey, iv);
      decipher.setAuthTag(tag);

      return Buffer.concat([decipher.update(Buffer.from(parts[4], 'base64')), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      throw new Error('SECURITY_DECRYPTION_FAILED');
    }
  }

  private resolveKey(raw: string, isProduction: boolean): Buffer {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return Buffer.from(raw, 'hex');
    }

    const asBase64 = Buffer.from(raw, 'base64');
    if (asBase64.length === 32 && asBase64.toString('base64') === raw) {
      return asBase64;
    }

    if (isProduction) {
      throw new Error(
        'ENCRYPTION_MASTER_KEY must be 32 bytes, encoded as 64 hex characters or as base64',
      );
    }

    this.logger.warn(
      'ENCRYPTION_MASTER_KEY is not a 32-byte key - deriving one with scrypt. Set a proper key before production.',
    );
    return scryptSync(raw, KDF_SALT, 32);
  }
}
