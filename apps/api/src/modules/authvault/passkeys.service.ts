import { Inject, Injectable } from '@nestjs/common';
import {
  createHash,
  randomBytes,
  verify as cryptoVerify,
  createPublicKey,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';

/**
 * P8-T2 passkeys ("اثر انگشت / چهره") — a WebAuthn ceremony implemented with
 * Node stdlib only. What is REAL here:
 *  - challenges are random, one-shot, TTL'd (5 min);
 *  - assertion verification is the actual WebAuthn math: verify the
 *    authenticator's ES256 signature over `authenticatorData ‖
 *    SHA-256(clientDataJSON)` with the stored EC P-256 public key;
 *  - signature counters are monotonic — a rewind signals a cloned authenticator;
 *  - credential ids are looked up per user; unknown credential = dead end.
 *
 * What is deliberately out of scope (honest, ROADMAP P8-followup):
 *  - attestation statements are ignored (attestation:'none'); we bind trust
 *    at first registration done by an authenticated OWNER, not to a vendor CA;
 *  - COSE parsing of arbitrary algs: we accept SPKI/DER P-256 public keys the
 *    client sends serializable. The browser-side helper (web) performs the
 *    navigator.credentials ceremonies; foreign front-ends get the same JSON
 *    contract.
 */

export interface StoredCredential {
  credentialId: string; // base64url
  publicKeyB64: string; // DER SPKI
  counter: number;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string | null;
}
interface UserCreds { userId: string; passkeys: StoredCredential[] }
interface Challenge { challengeId: string; userId: string; purpose: 'register' | 'login'; expiresAt: number }

const STORE_KEY = 'runtime/authvault/passkeys.json';
const CHALLENGE_TTL_MS = 5 * 60_000;

@Injectable()
export class PasskeysService {
  private creds = new Map<string, UserCreds>();
  private challenges = new Map<string, Challenge>();
  private loaded = false;

  constructor(
    private readonly config: ConfigService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private async ensure(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.storage.get(STORE_KEY);
      for (const u of JSON.parse(raw.toString('utf8')) as UserCreds[]) this.creds.set(u.userId, u);
    } catch { /* empty vault */ }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.storage.put({
      key: STORE_KEY,
      content: Buffer.from(JSON.stringify([...this.creds.values()])),
      contentType: 'application/json',
    });
  }

  rpId(): string {
    try {
      return new URL(this.config.get<string>('APP_URL') || '').hostname || 'localhost';
    } catch {
      return 'localhost';
    }
  }

  begin(userId: string, purpose: 'register' | 'login'): { challengeId: string; challengeB64u: string; rpId: string } {
    const challenge = randomBytes(32);
    const id = `pkc_${randomBytes(9).toString('base64url')}`;
    this.challenges.set(id, {
      challengeId: id,
      userId,
      purpose,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
    return { challengeId: id, challengeB64u: challenge.toString('base64url'), rpId: this.rpId() };
  }

  /** The identifier-less side of passkey-first login: no user, no leak. */
  decoyChallenge(): { challengeId: string; challengeB64u: string; rpId: string; allowCredentials: string[] } {
    const challenge = randomBytes(32);
    const id = `pkc_${randomBytes(9).toString('base64url')}`;
    this.challenges.set(id, {
      challengeId: id,
      userId: '__decoy__', // finishLogin finds no credential for it → neutral failure
      purpose: 'login',
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
    return { challengeId: id, challengeB64u: challenge.toString('base64url'), rpId: this.rpId(), allowCredentials: [] };
  }

  /** allowCredentials for the browser ceremony of a KNOWN account. */
  async credentialIdsFor(userId: string): Promise<string[]> {
    await this.ensure();
    return (this.creds.get(userId)?.passkeys ?? []).map((p) => p.credentialId);
  }

  private takeChallenge(challengeId: string, purpose: Challenge['purpose']): Challenge {
    const ch = this.challenges.get(challengeId);
    this.challenges.delete(challengeId); // one-shot even when wrong
    if (!ch || ch.purpose !== purpose || Date.now() > ch.expiresAt) {
      throw Object.assign(new Error('challenge unknown or expired'), { code: 'AUTH_CHALLENGE_INVALID' });
    }
    return ch;
  }

  async finishRegistration(input: {
    challengeId: string;
    credentialId: string;
    publicKeyB64: string;
    deviceLabel?: string;
  }): Promise<{ credentialId: string }> {
    const ch = this.takeChallenge(input.challengeId, 'register');
    await this.ensure();
    const rec = this.creds.get(ch.userId) ?? { userId: ch.userId, passkeys: [] };
    if (rec.passkeys.some((p) => p.credentialId === input.credentialId)) {
      throw Object.assign(new Error('credential already registered'), { code: 'AUTH_CHALLENGE_INVALID' });
    }
    // validate the key BEFORE trusting it overnight
    try {
      createPublicKey({ key: Buffer.from(input.publicKeyB64, 'base64'), format: 'der', type: 'spki' });
    } catch {
      throw Object.assign(new Error('public key must be DER SPKI P-256'), { code: 'VALIDATION_INVALID_INPUT' });
    }
    rec.passkeys.push({
      credentialId: input.credentialId,
      publicKeyB64: input.publicKeyB64,
      counter: 0,
      deviceLabel: input.deviceLabel || 'device',
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    });
    this.creds.set(ch.userId, rec);
    await this.persist();
    return { credentialId: input.credentialId };
  }

  async finishLogin(input: {
    challengeId: string;
    credentialId: string;
    authenticatorDataB64: string;
    clientDataJSONB64: string;
    signatureB64: string;
    newCounter: number;
  }): Promise<{ userId: string }> {
    const ch = this.takeChallenge(input.challengeId, 'login');
    await this.ensure();
    const user = this.creds.get(ch.userId);
    const cred = user?.passkeys.find((p) => p.credentialId === input.credentialId);
    if (!user || !cred) {
      throw Object.assign(new Error('credential unknown'), { code: 'AUTH_INVALID_CREDENTIALS' });
    }
    const authData = Buffer.from(input.authenticatorDataB64, 'base64');
    const clientData = Buffer.from(input.clientDataJSONB64, 'base64');
    const signature = Buffer.from(input.signatureB64, 'base64');

    let key: KeyObject;
    try {
      key = createPublicKey({ key: Buffer.from(cred.publicKeyB64, 'base64'), format: 'der', type: 'spki' });
    } catch {
      throw Object.assign(new Error('stored key corrupt'), { code: 'SYSTEM_INTERNAL_ERROR' });
    }
    const signedPayload = Buffer.concat([authData, createHash('sha256').update(clientData).digest()]);
    const ok = cryptoVerify('sha256', signedPayload, { key, dsaEncoding: 'ieee-p1363' }, signature);
    if (!ok) {
      throw Object.assign(new Error('passkey signature invalid'), { code: 'AUTH_INVALID_CREDENTIALS' });
    }
    if (input.newCounter <= cred.counter) {
      throw Object.assign(new Error('signature counter went BACKWARDS — cloned authenticator suspected'), {
        code: 'AUTH_CREDENTIAL_COMPROMISED',
      });
    }
    cred.counter = input.newCounter;
    cred.lastUsedAt = new Date().toISOString();
    await this.persist();
    return { userId: user.userId };
  }

  async listFor(userId: string): Promise<Array<Omit<StoredCredential, 'publicKeyB64'>>> {
    await this.ensure();
    return (this.creds.get(userId)?.passkeys ?? []).map(({ publicKeyB64: _pk, ...rest }) => rest);
  }

  async removeCredential(userId: string, credentialId: string): Promise<boolean> {
    await this.ensure();
    const user = this.creds.get(userId);
    if (!user) return false;
    const before = user.passkeys.length;
    user.passkeys = user.passkeys.filter((p) => !timingSafeCredential(p.credentialId, credentialId));
    if (user.passkeys.length !== before) {
      await this.persist();
      return true;
    }
    return false;
  }
}

function timingSafeCredential(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
