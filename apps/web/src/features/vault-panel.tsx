'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, setAreaTicket, getAreaTicket } from '@/lib/api';
import { t } from '@/i18n';

/**
 * P8 vault panel — the password & security desk inside the security tab:
 *  - area locks: set/disable/unlock (config/vault/ops) — real tickets stored
 *  - passkeys (اثر انگشت/چهره): navigator.credentials ceremony against our
 *    stdlib WebAuthn contract; browsers lacking getPublicKey() are told so,
 *    honestly, instead of fake-success
 *  - rotation robot: staleness advice + one-button rotate-all + credentials
 *    file download
 */

interface AreaStatus { area: string; locked: boolean; updatedAt: string | null }
interface Advice {
  key: string;
  status: 'fresh' | 'aging' | 'overdue' | 'never';
  ageDays: number | null;
  maxAgeDays: number;
  hintFa: string;
  lastRotatedAt: string | null;
}
interface PasskeyRow {
  credentialId: string;
  deviceLabel: string;
  counter: number;
  createdAt: string;
  lastUsedAt: string | null;
}

const ADVICE_TONE: Record<Advice['status'], string> = {
  fresh: 'var(--ok)',
  aging: 'var(--gold)',
  overdue: 'var(--bad)',
  never: 'var(--text-dim)',
};
const ADVICE_ICON: Record<Advice['status'], string> = { fresh: '🟢', aging: '🟡', overdue: '🔴', never: '⚪' };

export function VaultPanel() {
  const [areas, setAreas] = useState<AreaStatus[]>([]);
  const [advice, setAdvice] = useState<Advice[]>([]);
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pwDraft, setPwDraft] = useState<Record<string, string>>({});
  const [unlockDraft, setUnlockDraft] = useState<Record<string, string>>({});
  const [webauthnSupport, setWebauthnSupport] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [a, r, p] = await Promise.all([
        api.get<AreaStatus[]>('/dashboard/vault/areas'),
        api.get<Advice[]>('/dashboard/vault/rotation/advice'),
        api.get<PasskeyRow[]>('/dashboard/vault/passkeys').catch(() => [] as PasskeyRow[]),
      ]);
      setAreas(a);
      setAdvice(r);
      setPasskeys(p);
      // drop expired tickets
      for (const s of a) if (!s.locked) setAreaTicket(s.area, null);
    } catch { /* panel first paint */ }
  }, []);

  useEffect(() => {
    void refresh();
    setWebauthnSupport(
      typeof window !== 'undefined' &&
        typeof (window as { PublicKeyCredential?: unknown }).PublicKeyCredential !== 'undefined',
    );
  }, [refresh]);

  /* ---------- area locks ---------- */
  const setAreaPw = async (area: string) => {
    const password = pwDraft[area]?.trim();
    if (!password) return;
    setBusy(`set:${area}`);
    try {
      await api.post(`/dashboard/vault/areas/${area}/password`, { password });
      setMsg(t('vault.msg.lockSet'));
      setPwDraft((d) => ({ ...d, [area]: '' }));
      await refresh();
    } catch {
      setMsg(t('vault.msg.fail'));
    } finally {
      setBusy(null);
    }
  };

  const disableArea = async (area: string) => {
    setBusy(`disable:${area}`);
    try {
      await api.post(`/dashboard/vault/areas/${area}/disable`, {});
      setAreaTicket(area, null);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const unlockArea = async (area: string) => {
    const password = unlockDraft[area]?.trim();
    if (!password) return;
    setBusy(`unlock:${area}`);
    try {
      const res = await api.post<{ ticket: string; expiresAt: string }>(`/dashboard/vault/areas/${area}/unlock`, { password });
      setAreaTicket(area, res);
      setMsg(t('vault.msg.unlocked'));
      setUnlockDraft((d) => ({ ...d, [area]: '' }));
    } catch {
      setMsg(t('vault.msg.wrongPw'));
    } finally {
      setBusy(null);
    }
  };

  /* ---------- passkeys ---------- */
  const registerPasskey = async () => {
    setBusy('passkey');
    setMsg(null);
    try {
      if (!webauthnSupport) {
        setMsg(t('vault.passkey.unsupported'));
        return;
      }
      const begin = await api.post<{ challengeId: string; challengeB64u: string; rpId: string }>(
        '/dashboard/vault/passkeys/register/begin',
        {},
      );
      const challengeBytes = Uint8Array.from(atob(begin.challengeB64u.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      const publicKey: PublicKeyCredentialCreationOptions = {
        rp: { name: 'Legal Platform' },
        user: {
          id: new TextEncoder().encode(`user:${Date.now()}`),
          name: 'owner@office',
          displayName: 'Office owner',
        },
        challenge: challengeBytes as unknown as BufferSource,
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { userVerification: 'required' },
        attestation: 'none',
        timeout: 60_000,
      };
      const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential & {
        response: AuthenticatorAttestationResponse & { getPublicKey?: () => ArrayBuffer | null };
      };
      if (!cred?.response?.getPublicKey) {
        setMsg(t('vault.passkey.unsupported'));
        return;
      }
      const spki = cred.response.getPublicKey();
      if (!spki) {
        setMsg(t('vault.passkey.unsupported'));
        return;
      }
      await api.post('/dashboard/vault/passkeys/register/finish', {
        challengeId: begin.challengeId,
        credentialId: cred.id,
        publicKeyB64: btoa(String.fromCharCode(...new Uint8Array(spki))),
        deviceLabel: navigator.userAgent.includes('Mobile') ? '📱 موبایل' : '💻 لپ‌تاپ',
      });
      setMsg(t('vault.msg.passkeyAdded'));
      await refresh();
    } catch {
      setMsg(t('vault.passkey.cancelled'));
    } finally {
      setBusy(null);
    }
  };

  /* ---------- rotation ---------- */
  const rotateAll = async () => {
    setBusy('rotate');
    try {
      const res = await api.post<{ credentialsFile: string }>('/dashboard/vault/rotation/rotate-all', {});
      // one-shot download, not stored anywhere client-side
      const blob = new Blob([res.credentialsFile], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `legal-platform-credentials-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(t('vault.msg.rotated'));
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const card: React.CSSProperties = {
    background: 'var(--panel)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--radius)',
    padding: 16,
    marginTop: 12,
  };
  const inputS: React.CSSProperties = {
    background: 'rgba(0,0,0,0.25)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    padding: '8px 10px',
    fontSize: 13,
    minWidth: 0,
    flex: 1,
  };

  return (
    <section style={{ marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>🤖 {t('vault.title')}</h3>
      {msg && <div className="pill gold" style={{ display: 'inline-block', marginBottom: 8 }}>{msg}</div>}

      {/* rotation robot */}
      <div style={card}>
        <h4 style={{ margin: '0 0 8px' }}>{t('vault.rotation.title')}</h4>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {advice.map((a) => (
            <li key={a.key} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--line)', fontSize: 13 }}>
              <span>{ADVICE_ICON[a.status]}</span>
              <span style={{ color: ADVICE_TONE[a.status], minWidth: 110 }}>{a.key}</span>
              <span style={{ color: 'var(--text-dim)', flex: 1 }}>{a.hintFa}</span>
              <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                {a.ageDays === null ? t('vault.rotation.never') : `${a.ageDays}d / ${a.maxAgeDays}d`}
              </span>
            </li>
          ))}
        </ul>
        <button className="pill ok" disabled={busy === 'rotate'} onClick={() => void rotateAll()} style={{ marginTop: 8, cursor: 'pointer' }}>
          {busy === 'rotate' ? '…' : `🔄 ${t('vault.rotation.rotateAll')}`}
        </button>
        <small style={{ display: 'block', marginTop: 6, color: 'var(--text-dim)' }}>{t('vault.rotation.note')}</small>
      </div>

      {/* area locks */}
      <div style={card}>
        <h4 style={{ margin: '0 0 8px' }}>{t('vault.locks.title')}</h4>
        {areas.map((a) => (
          <div key={a.area} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className={`pill ${a.locked ? 'ok' : ''}`}>{a.locked ? '🔒' : '🔓'}</span>
              <b style={{ minWidth: 80 }}>{a.area}</b>
              {a.locked && getAreaTicket(a.area) && <span className="pill teal">{t('vault.locks.ticketAlive')}</span>}
              {a.updatedAt && <small style={{ color: 'var(--text-dim)' }}>{new Date(a.updatedAt).toLocaleDateString('fa-IR')}</small>}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {a.locked ? (
                <>
                  <input
                    type="password"
                    style={inputS}
                    placeholder={t('vault.locks.unlockPh')}
                    value={unlockDraft[a.area] ?? ''}
                    onChange={(e) => setUnlockDraft((d) => ({ ...d, [a.area]: e.target.value }))}
                  />
                  <button className="pill teal" disabled={busy === `unlock:${a.area}`} onClick={() => void unlockArea(a.area)} style={{ cursor: 'pointer' }}>
                    {t('vault.locks.unlock')}
                  </button>
                  <button className="pill" disabled={busy === `disable:${a.area}`} onClick={() => void disableArea(a.area)} style={{ cursor: 'pointer' }}>
                    {t('vault.locks.disable')}
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="password"
                    style={inputS}
                    placeholder={t('vault.locks.newPw')}
                    value={pwDraft[a.area] ?? ''}
                    onChange={(e) => setPwDraft((d) => ({ ...d, [a.area]: e.target.value }))}
                  />
                  <button className="pill ok" disabled={busy === `set:${a.area}`} onClick={() => void setAreaPw(a.area)} style={{ cursor: 'pointer' }}>
                    {t('vault.locks.set')}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* passkeys */}
      <div style={card}>
        <h4 style={{ margin: '0 0 8px' }}>🔑 {t('vault.passkey.title')}</h4>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '0 0 8px' }}>{t('vault.passkey.hint')}</p>
        {webauthnSupport === false && (
          <div className="pill bad" style={{ display: 'inline-block', marginBottom: 8 }}>{t('vault.passkey.unsupported')}</div>
        )}
        {passkeys.length === 0 ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{t('vault.passkey.none')}</div>
        ) : (
          passkeys.map((p) => (
            <div key={p.credentialId} style={{ borderTop: '1px solid var(--line)', padding: '6px 0', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>🔒</span>
              <span>{p.deviceLabel}</span>
              <small style={{ color: 'var(--text-dim)' }}>{p.credentialId.slice(0, 14)}…</small>
              <small style={{ color: 'var(--text-dim)' }}>{t('vault.passkey.uses', undefined as never)} {p.counter}</small>
            </div>
          ))
        )}
        <button className="pill violet" disabled={busy === 'passkey' || webauthnSupport === false} onClick={() => void registerPasskey()} style={{ marginTop: 8, cursor: 'pointer' }}>
          {busy === 'passkey' ? '…' : `＋ ${t('vault.passkey.add')}`}
        </button>
      </div>
    </section>
  );
}
