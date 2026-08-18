import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly masterKey: Buffer;
  private readonly algorithm = 'aes-256-gcm';

  constructor(private configService: ConfigService) {
    const keyBase64 = this.configService.get<string>('ENCRYPTION_MASTER_KEY');
    
    if (!keyBase64) {
      throw new Error('ENCRYPTION_MASTER_KEY is not configured');
    }

    this.masterKey = Buffer.from(keyBase64, 'base64');
    
    if (this.masterKey.length !== 32) {
      throw new Error('ENCRYPTION_MASTER_KEY must be a 32-byte base64-encoded key');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.masterKey, iv);
    
    let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
    ciphertext += cipher.final('base64');
    
    const tag = cipher.getAuthTag().toString('base64');
    
    // Format: enc:v1:<base64 iv>:<base64 tag>:<base64 ciphertext>
    return `enc:v1:${iv.toString('base64')}:${tag}:${ciphertext}`;
  }

  decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':');
    
    if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
      throw new Error('SECURITY_INVALID_ENCRYPTED_FORMAT');
    }

    const iv = Buffer.from(parts[2], 'base64');
    const tag = Buffer.from(parts[3], 'base64');
    const data = parts[4];

    try {
      const decipher = createDecipheriv(this.algorithm, this.masterKey, iv);
      decipher.setAuthTag(tag);
      
      let plaintext = decipher.update(data, 'base64', 'utf8');
      plaintext += decipher.final('utf8');
      
      return plaintext;
    } catch (error) {
      throw new Error('SECURITY_DECRYPTION_FAILED');
    }
  }
}
