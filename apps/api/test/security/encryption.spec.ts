import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../../src/security/encryption.service';
import { randomBytes } from 'crypto';

const buildService = (key: string | undefined, nodeEnv = 'development'): EncryptionService => {
  if (key === undefined) {
    delete process.env.ENCRYPTION_MASTER_KEY;
  } else {
    process.env.ENCRYPTION_MASTER_KEY = key;
  }
  process.env.NODE_ENV = nodeEnv;
  return new EncryptionService(new ConfigService());
};

describe('EncryptionService', () => {
  const originalKey = process.env.ENCRYPTION_MASTER_KEY;
  const originalEnv = process.env.NODE_ENV;

  afterAll(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_MASTER_KEY;
    else process.env.ENCRYPTION_MASTER_KEY = originalKey;
    process.env.NODE_ENV = originalEnv;
  });

  it('round-trips a secret and produces a versioned envelope', () => {
    const service = buildService(randomBytes(32).toString('base64'));

    const envelope = service.encrypt('gateway-api-key');

    expect(envelope.startsWith('enc:v1:')).toBe(true);
    expect(envelope).not.toContain('gateway-api-key');
    expect(service.decrypt(envelope)).toBe('gateway-api-key');
  });

  it('uses a fresh IV per encryption so identical plaintexts differ', () => {
    const service = buildService(randomBytes(32).toString('base64'));

    expect(service.encrypt('same')).not.toBe(service.encrypt('same'));
  });

  /**
   * Regression: scripts/install.sh generated the key with `openssl rand -hex 32`.
   * Base64-decoding 64 hex characters yields 48 bytes, which the old strict
   * check rejected, so a freshly installed server could not start.
   */
  it('accepts the 64-hex-character key format produced by the installer', () => {
    const service = buildService(randomBytes(32).toString('hex'));

    expect(service.decrypt(service.encrypt('secret'))).toBe('secret');
  });

  it('detects tampering through the GCM auth tag', () => {
    const service = buildService(randomBytes(32).toString('base64'));
    const envelope = service.encrypt('provider-secret');
    const parts = envelope.split(':');
    parts[4] = Buffer.from('tampered').toString('base64');

    expect(() => service.decrypt(parts.join(':'))).toThrow('SECURITY_DECRYPTION_FAILED');
  });

  it('rejects a malformed envelope', () => {
    const service = buildService(randomBytes(32).toString('base64'));

    expect(() => service.decrypt('not-an-envelope')).toThrow('SECURITY_INVALID_ENCRYPTED_FORMAT');
  });

  it('refuses to start in production without a usable key', () => {
    expect(() => buildService('', 'production')).toThrow('ENCRYPTION_MASTER_KEY is not configured');
    expect(() => buildService('short-and-wrong', 'production')).toThrow(/32 bytes/);
  });

  it('derives a working key in development when none is configured', () => {
    const service = buildService(undefined, 'development');

    expect(service.decrypt(service.encrypt('dev-secret'))).toBe('dev-secret');
  });
});
