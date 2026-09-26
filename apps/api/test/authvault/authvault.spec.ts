import { generateKeyPairSync, createHash, sign as cryptoSign } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { AreaLockService } from '../../src/modules/authvault/area-lock.service';
import { PasskeysService } from '../../src/modules/authvault/passkeys.service';
import { RotationService } from '../../src/modules/authvault/rotation.service';
import { MachineTokensService } from '../../src/modules/machine-tokens/machine-tokens.service';
import { RateLimitService } from '../../src/common/rate-limit.service';
import type { StorageProvider } from '../../src/providers/storage/storage.provider';
import { ERROR_CODES } from '@legal-platform/contracts';

function memStorage(): StorageProvider {
  const store = new Map<string, Buffer>();
  return {
    put: async ({ key, content }) => {
      store.set(key, Buffer.isBuffer(content) ? content : Buffer.from(content));
      return { url: `mem://${key}`, key };
    },
    get: async (key) => {
      const v = store.get(key);
      if (!v) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return v;
    },
    delete: async (k) => void store.delete(k),
    list: async () => ({ objects: [...store.keys()].map((key) => ({ key, size: 0, lastModified: new Date() })), hasMore: false }),
    verifyConfig: async () => ({ valid: true }),
    getMetadata: () => ({ name: 'mem', driverType: 'local' as const }),
  };
}

/* ---------------- Area locks ---------------- */

describe('P8 area locks — second-factor gates on dangerous surfaces', () => {
  it('set → unlock tickets; wrong password rejected; epoch bump kills old tickets', async () => {
    const svc = new AreaLockService(
      new ConfigService({ JWT_ACCESS_SECRET: 's' }),
      new RateLimitService(),
      memStorage(),
    );
    // open area: unlock passes trivially, verifyTicket true without ticket
    const open1 = await svc.unlock('config', 'whatever', '1.1.1.1');
    expect(await svc.verifyTicket('config', undefined)).toBe(true);

    await svc.setPassword('config', 'correct-horse-battery', 'owner-1');
    expect(await svc.verifyTicket('config', undefined)).toBe(false);

    await expect(svc.unlock('config', 'totally-wrong', '1.1.1.1')).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
    });

    const { ticket, expiresAt } = await svc.unlock('config', 'correct-horse-battery', '1.1.1.1');
    expect(ticket.startsWith('alt_config_')).toBe(true);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
    expect(await svc.verifyTicket('config', ticket)).toBe(true);
    const tampered = ticket.slice(0, -1) + (ticket.endsWith('0') ? '1' : '0');
    expect(await svc.verifyTicket('config', tampered)).toBe(false); // tampered sig

    // password rotation → old tickets die immediately even before expiry
    await svc.setPassword('config', 'a-brand-new-pass', 'owner-1', 'correct-horse-battery');
    expect(await svc.verifyTicket('config', ticket)).toBe(false);
    void open1;
  });

  it('an open session alone cannot replace or remove a lock: the current password is required', async () => {
    const svc = new AreaLockService(new ConfigService({ JWT_ACCESS_SECRET: 's' }), new RateLimitService(), memStorage());
    await svc.setPassword('config', 'original-secret', 'owner-1');

    await expect(svc.setPassword('config', 'attacker-chosen', 'owner-1')).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
    });
    await expect(svc.disable('config', 'owner-1', 'wrong-guess')).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
    });
    expect((await svc.status()).find((a) => a.area === 'config')?.locked).toBe(true);

    await svc.disable('config', 'owner-1', 'original-secret');
    expect((await svc.status()).find((a) => a.area === 'config')?.locked).toBe(false);
    // an open area can be locked again without a current password
    await svc.setPassword('config', 'second-secret', 'owner-1');
    expect((await svc.status()).find((a) => a.area === 'config')?.locked).toBe(true);
  });

  it('persistence: a fresh service instance still enforces the lock (restart honesty)', async () => {
    const storage = memStorage();
    const cfg = new ConfigService({ JWT_ACCESS_SECRET: 's' });
    const a = new AreaLockService(cfg, new RateLimitService(), storage);
    await a.setPassword('vault', 'very-first-secret', 'owner-1');
    const b = new AreaLockService(cfg, new RateLimitService(), storage);
    await expect(b.unlock('vault', 'nope-nope-nope', '1.1.1.1')).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
    });
    const ok = await b.unlock('vault', 'very-first-secret', '1.1.1.1');
    expect(await b.verifyTicket('vault', ok.ticket)).toBe(true);
  });

  it('weak passwords are refused (min length), unlock attempts are rate-limited with lockout', async () => {
    const svc = new AreaLockService(new ConfigService({}), new RateLimitService(), memStorage());
    await expect(svc.setPassword('ops', 'short', 'u')).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_INVALID_INPUT,
    });
    await svc.setPassword('ops', 'long-enough-pass', 'u');
    for (let i = 0; i < 5; i += 1) {
      await expect(svc.unlock('ops', `wrong-${i}`, '2.2.2.2')).rejects.toBeTruthy();
    }
    await expect(svc.unlock('ops', 'long-enough-pass', '2.2.2.2')).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_INVALID_CREDENTIALS, // locked out, even with the RIGHT password
    });
  });
});

/* ---------------- Passkeys ---------------- */

describe('P8 passkeys — real WebAuthn assertion math (ES256 over authData‖sha256(clientData))', () => {
  function buildP256Pair() {
    return generateKeyPairSync('ec', { namedCurve: 'P-256' });
  }
  const exportSpkiB64 = (pub: ReturnType<typeof generateKeyPairSync>['publicKey']) =>
    pub.export({ format: 'der', type: 'spki' }).toString('base64');

  it('full ceremony: challenge(one-shot) → register → login verified end-to-end', async () => {
    const svc = new PasskeysService(new ConfigService({ APP_URL: 'https://office.example' }), memStorage());
    const { publicKey, privateKey } = buildP256Pair();

    // register
    const reg = svc.begin('owner-1', 'register');
    expect(reg.rpId).toBe('office.example');
    // challenge dies on reuse even before validating payload
    await svc.finishRegistration({
      challengeId: reg.challengeId,
      credentialId: 'cred-1',
      publicKeyB64: exportSpkiB64(publicKey),
      deviceLabel: 'Managed phone',
    });
    await expect(
      svc.finishRegistration({ challengeId: reg.challengeId, credentialId: 'c', publicKeyB64: '' }),
    ).rejects.toMatchObject({ code: 'AUTH_CHALLENGE_INVALID' });

    // login
    const login = svc.begin('owner-1', 'login');
    const authData = Buffer.from('authbytes');
    const clientData = Buffer.from('{"challenge":"x","type":"webauthn.get"}');
    const payload = Buffer.concat([authData, createHash('sha256').update(clientData).digest()]);
    const sig = cryptoSign('sha256', payload, { key: privateKey, dsaEncoding: 'ieee-p1363' });
    const session = await svc.finishLogin({
      challengeId: login.challengeId,
      credentialId: 'cred-1',
      authenticatorDataB64: authData.toString('base64'),
      clientDataJSONB64: clientData.toString('base64'),
      signatureB64: sig.toString('base64'),
      newCounter: 1,
    });
    expect(session.userId).toBe('owner-1');
  });

  it('WRONG signature dies + cloned authenticator (counter rewind) is flagged, never bypassed', async () => {
    const svc = new PasskeysService(new ConfigService({}), memStorage());
    const { publicKey, privateKey } = buildP256Pair();
    const reg = svc.begin('u1', 'register');
    await svc.finishRegistration({ challengeId: reg.challengeId, credentialId: 'k1', publicKeyB64: exportSpkiB64(publicKey) });

    const login = svc.begin('u1', 'login');
    const authData = Buffer.from('ad');
    const clientData = Buffer.from('cd');
    const payload = Buffer.concat([authData, createHash('sha256').update(clientData).digest()]);
    const fakeSig = cryptoSign('sha256', Buffer.from('different payload'), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    await expect(
      svc.finishLogin({
        challengeId: login.challengeId,
        credentialId: 'k1',
        authenticatorDataB64: authData.toString('base64'),
        clientDataJSONB64: clientData.toString('base64'),
        signatureB64: fakeSig.toString('base64'),
        newCounter: 1,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });

    const login2 = svc.begin('u1', 'login');
    const goodSig = cryptoSign('sha256', payload, { key: privateKey, dsaEncoding: 'ieee-p1363' });
    await svc.finishLogin({
      challengeId: login2.challengeId,
      credentialId: 'k1',
      authenticatorDataB64: authData.toString('base64'),
      clientDataJSONB64: clientData.toString('base64'),
      signatureB64: goodSig.toString('base64'),
      newCounter: 5,
    });

    // counter rewind — reused or cloned authenticator
    const login3 = svc.begin('u1', 'login');
    const goodSig3 = cryptoSign('sha256', payload, { key: privateKey, dsaEncoding: 'ieee-p1363' });
    await expect(
      svc.finishLogin({
        challengeId: login3.challengeId,
        credentialId: 'k1',
        authenticatorDataB64: authData.toString('base64'),
        clientDataJSONB64: clientData.toString('base64'),
        signatureB64: goodSig3.toString('base64'),
        newCounter: 3,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_CREDENTIAL_COMPROMISED' });
  });
});

/* ---------------- Rotation robot ---------------- */

describe('P8 rotation bot — one button, every platform-owned secret', () => {
  it('advice reports never→fresh honestly; rotate-all kills old machine tokens, mints new ones, and the file carries them ONCE', async () => {
    const storage = memStorage();
    const machine = new MachineTokensService(new ConfigService({ MACHINE_TOKEN_SECRET: 'rot-test' }), storage);
    const rotation = new RotationService(machine, storage);

    const before = await rotation.advice();
    // nothing issued yet: nothing to rotate, so no nagging
    expect(before.find((a) => a.key === 'machine-tokens')?.status).toBe('not_applicable');

    const t1 = await machine.issue({ label: 'mini-app', scopes: ['client:read'], createdBy: 'u1' });
    const t2 = await machine.issue({ label: 'stream-feeder', scopes: ['events:stream'], createdBy: 'u1' });

    const result = await rotation.rotateAll('owner-1');

    // old tokens are DEAD immediately (served by the SAME persisted store)
    expect(await machine.verify(t1.token, 'client:read')).toBeNull();
    expect(await machine.verify(t2.token, 'events:stream')).toBeNull();
    expect(result.revokedOldCount).toBe(2);

    // new credentials verify with the SAME scopes under the SAME labels
    expect(result.machineTokens).toHaveLength(2);
    const freshMini = result.machineTokens.find((m) => m.label === 'mini-app')!;
    expect(await machine.verify(freshMini.token, 'client:read')).not.toBeNull();
    expect(freshMini.scopes).toEqual(['client:read']);

    // the file: one-shot carries each new token verbatim, plus the honesty notes
    expect(result.credentialsFile).toContain(freshMini.token);
    expect(result.credentialsFile).toContain('ONE-TIME export');
    expect(result.credentialsFile).toContain('env'); // JWT secrets honesty note present

    // epochs recorded + advice flips to fresh
    const after = await rotation.advice();
    expect(after.find((a) => a.key === 'machine-tokens')?.status).toBe('fresh');
    expect(after.find((a) => a.key === 'jwt-secrets')?.status).toBe('manual'); // env-owned: we DON'T pretend
    // rotate-all does not touch area passwords, so it must not claim it did
    expect(after.find((a) => a.key === 'area-passwords')?.lastRotatedAt ?? null).toBeNull();
    expect(after.find((a) => a.key === 'webhook-signing')).toBeUndefined();

    // restart honesty: rotation epochs survive a fresh service over same storage
    const rebooted = new RotationService(machine, storage);
    const advice2 = await rebooted.advice();
    expect(advice2.find((a) => a.key === 'machine-tokens')?.lastRotatedAt).not.toBeNull();
  });
});
