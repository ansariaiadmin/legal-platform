import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { PasskeysService } from '../../src/modules/authvault/passkeys.service';
import { AuthService } from '../../src/modules/auth/auth.service';

/**
 * P12-i — passkey-FIRST login. A phone/email + a REAL ES256 WebAuthn
 * signature walks in with NO OTP anywhere. Ceremony math is genuine (Node
 * crypto generates the key, signs authenticatorData‖SHA256(clientDataJSON));
 * forgery = broken WebAuthn, not a mock's word.
 */

function memStorage() {
  const store = new Map<string, Buffer>();
  return {
    put: async ({ key, content }: { key: string; content: Buffer }) => { store.set(key, content); },
    get: async (key: string) => {
      const v = store.get(key);
      if (!v) throw new Error('not found');
      return v;
    },
    delete: async (key: string) => { store.delete(key); },
    list: async () => [],
  } as never;
}

function scriptedPool() {
  const users = new Map<string, { id: string; email: string | null; phone: string }>();
  const roles = new Map<string, string[]>();
  const sessions: Array<{ user_id: string }> = [];
  return {
    users, roles, sessions,
    async query(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
      const t = sql.replace(/\s+/g, ' ').trim();
      if (t.startsWith('SELECT id FROM users WHERE email')) {
        const hit = [...users.entries()].find(([, u]) => u.email === params[0]);
        return { rows: hit ? [{ id: hit[0] }] : [] };
      }
      if (t.startsWith('SELECT id FROM users WHERE phone_normalized')) {
        const hit = [...users.entries()].find(([, u]) => u.phone === params[0]);
        return { rows: hit ? [{ id: hit[0] }] : [] };
      }
      if (t.startsWith('SELECT u.id, u.phone_normalized')) {
        const id = params[0] as string;
        const u = users.get(id);
        if (!u) return { rows: [] };
        return {
          rows: [{
            id, phone_normalized: u.phone, email: u.email,
            display_name: 'مالک دفتر', status: 'active', roles: roles.get(id) ?? ['lawyer_owner'],
          }],
        };
      }
      if (t.startsWith('INSERT INTO user_sessions')) {
        sessions.push({ user_id: params[1] as string });
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

interface RealKey {
  credentialId: string;
  signAssertion(authData: Buffer, clientData: Buffer): Buffer;
}

async function enrollRealKey(passkeys: PasskeysService, userId: string, credentialId: string): Promise<RealKey> {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const reg = passkeys.begin(userId, 'register');
  await passkeys.finishRegistration({
    challengeId: reg.challengeId,
    credentialId,
    publicKeyB64: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    deviceLabel: 'test-device',
  });
  const priv: KeyObject = pair.privateKey;
  return {
    credentialId,
    signAssertion(authData, clientData) {
      return cryptoSign('sha256', Buffer.concat([authData, createHash('sha256').update(clientData).digest()]),
        { key: priv, dsaEncoding: 'ieee-p1363' });
    },
  };
}

describe('passkey-first login (P12-i)', () => {
  const OWNER_PHONE = '+989120000001';

  function boot() {
    const pool = scriptedPool();
    pool.users.set('u-owner', { id: 'u-owner', email: 'owner@firm.ir', phone: OWNER_PHONE });
    pool.roles.set('u-owner', ['lawyer_owner']);
    const passkeys = new PasskeysService(new ConfigService({ APP_URL: 'https://app.example.com' }), memStorage());
    const auth = new AuthService(
      pool as never,
      new JwtService({ secret: 'x'.repeat(40) }),
      new ConfigService({ JWT_ACCESS_SECRET: 'x'.repeat(40), JWT_REFRESH_SECRET: 'y'.repeat(40) }),
      { log: async () => undefined } as never,
      { consume: () => ({ allowed: true }), reset: () => undefined } as never,
      { sendOtp: async () => ({ success: true }) } as never,
      { send: async () => ({ success: true }) } as never,
    );
    auth.bindPasskeys(passkeys);
    return { auth, passkeys, pool };
  }

  it('FULL ceremony: begin(phone) → signed assertion → real session tokens', async () => {
    const { auth, passkeys, pool } = boot();
    const key = await enrollRealKey(passkeys, 'u-owner', 'cred-1');

    const begin = await auth.beginPasskeyLogin(OWNER_PHONE, '1.2.3.4');
    expect(begin.challengeId).toMatch(/^pkc_/);
    expect(begin.allowCredentials).toEqual(['cred-1']);

    const authData = Buffer.alloc(37, 1);
    const clientData = Buffer.from(JSON.stringify({
      type: 'webauthn.get', challenge: begin.challengeB64u, origin: 'https://app.example.com',
    }));
    const result = await auth.finishPasskeyLogin({
      challengeId: begin.challengeId,
      credentialId: key.credentialId,
      authenticatorDataB64: authData.toString('base64'),
      clientDataJSONB64: clientData.toString('base64'),
      signatureB64: key.signAssertion(authData, clientData).toString('base64'),
      newCounter: 1,
    }, '1.2.3.4');

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.id).toBe('u-owner');
    expect(pool.sessions).toHaveLength(1); // a REAL session row was created
  });

  it('unknown identifier gets a DECOY challenge — same shape, no oracle', async () => {
    const { auth } = boot();
    const begin = await auth.beginPasskeyLogin('+989990000000', '1.2.3.4');
    expect(begin.challengeId).toMatch(/^pkc_/);
    expect(begin.allowCredentials).toEqual([]);
    await expect(auth.finishPasskeyLogin({
      challengeId: begin.challengeId, credentialId: 'whatever',
      authenticatorDataB64: 'AA', clientDataJSONB64: 'AA',
      signatureB64: 'AA', newCounter: 1,
    }, '1.2.3.4')).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
  });

  it('tampered signature NEVER issues tokens', async () => {
    const { auth, passkeys } = boot();
    await enrollRealKey(passkeys, 'u-owner', 'cred-1');
    const begin = await auth.beginPasskeyLogin(OWNER_PHONE, '1.2.3.4');
    await expect(auth.finishPasskeyLogin({
      challengeId: begin.challengeId,
      credentialId: 'cred-1',
      authenticatorDataB64: Buffer.alloc(37, 1).toString('base64'),
      clientDataJSONB64: Buffer.from('{"type":"webauthn.get"}').toString('base64'),
      signatureB64: Buffer.alloc(64, 9).toString('base64'), // forged
      newCounter: 1,
    }, '1.2.3.4')).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
  });

  it('challenges are one-shot — replay after success dies', async () => {
    const { auth, passkeys } = boot();
    const key = await enrollRealKey(passkeys, 'u-owner', 'cred-1');
    const begin = await auth.beginPasskeyLogin(OWNER_PHONE, '1.2.3.4');
    const authData = Buffer.alloc(37, 1);
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: begin.challengeB64u }));
    const payload = {
      challengeId: begin.challengeId, credentialId: key.credentialId,
      authenticatorDataB64: authData.toString('base64'), clientDataJSONB64: clientData.toString('base64'),
      signatureB64: key.signAssertion(authData, clientData).toString('base64'), newCounter: 1,
    };
    await auth.finishPasskeyLogin(payload, '1.2.3.4');
    payload.newCounter = 2; // counter steps up so the replay is 'valid' math
    payload.signatureB64 = key.signAssertion(authData, clientData).toString('base64');
    await expect(auth.finishPasskeyLogin(payload, '1.2.3.4'))
      .rejects.toMatchObject({ code: 'AUTH_CHALLENGE_INVALID' });
  });

  it('dead database ⇒ honest 503 AUTH_DEPENDENCY_DOWN, never a raw 500 at the door', async () => {
    const { auth } = boot();
    (auth as unknown as { pool: { query: () => Promise<never> } }).pool = {
      query: async () => {
        const err = new Error('ECONNREFUSED');
        throw err;
      },
    };
    await expect(auth.beginPasskeyLogin(OWNER_PHONE, '1.2.3.4')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('accounts without passkeys get a truthful empty allowlist', async () => {
    const { auth } = boot(); // u-owner has NO passkeys enrolled
    const begin = await auth.beginPasskeyLogin(OWNER_PHONE, '1.2.3.4');
    expect(begin.allowCredentials).toEqual([]);
  });
});
