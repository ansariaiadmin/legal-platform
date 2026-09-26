'use client';

import { useCallback, useEffect, useState } from 'react';
import { Fingerprint, KeyRound, Lock, LockOpen, RefreshCw } from 'lucide-react';
import { api, ApiError, setAreaTicket, getAreaTicket } from '@/lib/api';
import { dateLocale, getPrefs, num, t, tx } from '@/i18n';

/**
 * P8 vault panel — the password & security desk inside the security tab:
 *  - area locks: set/disable/unlock (config/vault/ops) — real tickets stored
 *  - passkeys (fingerprint / face): navigator.credentials ceremony against our
 *    stdlib WebAuthn contract; browsers lacking getPublicKey() are told so,
 *    honestly, instead of fake-success
 *  - rotation robot: staleness advice + one-button rotate-all + credentials
 *    file download
 */

interface AreaStatus { area: string; locked: boolean; updatedAt: string | null }
interface Advice {
  key: string;
  status: 'fresh' | 'aging' | 'overdue' | 'never' | 'not_applicable' | 'manual';
  ageDays: number | null;
  maxAgeDays: number;
  hintFa: string;
  hintEn?: string;
  lastRotatedAt: string | null;
}
interface PasskeyRow {
  credentialId: string;
  deviceLabel: string;
  counter: number;
  createdAt: string;
  lastUsedAt: string | null;
}

function areaLabel(area: string): string {
  switch (area) {
    case 'config':
      return tx('تنظیمات مدل هوش مصنوعی', 'AI model settings');
    case 'vault':
      return tx('نوسازی توکن‌ها', 'Token renewal');
    case 'ops':
      return tx('پشتیبان‌گیری و بازیابی', 'Backup and restore');
    default:
      return area;
  }
}

function adviceLabel(key: string): string {
  switch (key) {
    case 'machine-tokens':
      return tx('توکن‌های ماشینی', 'Machine tokens');
    case 'area-passwords':
      return tx('رمز بخش‌ها', 'Section passwords');
    case 'jwt-secrets':
      return tx('کلیدهای JWT', 'JWT keys');
    default:
      return key;
  }
}

function adviceBadge(a: Advice) {
  switch (a.status) {
    case 'fresh':
      return <span className="pill ok">{tx('به‌روز', 'Up to date')}</span>;
    case 'aging':
      return <span className="pill gold">{tx('نزدیک به موعد', 'Due soon')}</span>;
    case 'overdue':
      return <span className="pill bad">{tx('موعد گذشته', 'Overdue')}</span>;
    case 'never':
      return <span className="pill gold">{tx('هرگز عوض نشده', 'Never changed')}</span>;
    case 'manual':
      return <span className="pill">{tx('دستی', 'Manual')}</span>;
    default:
      return <span className="pill">{tx('موردی نیست', 'None')}</span>;
  }
}

function errText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

export function VaultPanel() {
  const [areas, setAreas] = useState<AreaStatus[]>([]);
  const [advice, setAdvice] = useState<Advice[]>([]);
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwDraft, setPwDraft] = useState<Record<string, string>>({});
  const [unlockDraft, setUnlockDraft] = useState<Record<string, string>>({});
  const [changing, setChanging] = useState<string | null>(null);
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
  const setAreaPw = async (area: string, currentPassword?: string) => {
    const password = pwDraft[area] ?? '';
    if (password.length < 8) {
      setMsg({ ok: false, text: t('vault.msg.fail') });
      return;
    }
    setBusy(`set:${area}`);
    setMsg(null);
    try {
      await api.post(`/dashboard/vault/areas/${area}/password`, { password, currentPassword });
      setMsg({ ok: true, text: t('vault.msg.lockSet') });
      setPwDraft((d) => ({ ...d, [area]: '' }));
      setUnlockDraft((d) => ({ ...d, [area]: '' }));
      setAreaTicket(area, null);
      setChanging(null);
      await refresh();
    } catch (e) {
      setMsg({ ok: false, text: currentPassword !== undefined ? t('vault.msg.wrongPw') : errText(e, t('vault.msg.fail')) });
    } finally {
      setBusy(null);
    }
  };

  const disableArea = async (area: string) => {
    const currentPassword = unlockDraft[area] ?? '';
    if (!currentPassword) {
      setMsg({ ok: false, text: tx('برای حذف رمز، ابتدا رمز فعلی را وارد کنید.', 'Enter the current password to remove it.') });
      return;
    }
    setBusy(`disable:${area}`);
    setMsg(null);
    try {
      await api.post(`/dashboard/vault/areas/${area}/disable`, { currentPassword });
      setAreaTicket(area, null);
      setUnlockDraft((d) => ({ ...d, [area]: '' }));
      setMsg({ ok: true, text: tx('رمز این بخش حذف شد.', 'The section password was removed.') });
      await refresh();
    } catch {
      setMsg({ ok: false, text: t('vault.msg.wrongPw') });
    } finally {
      setBusy(null);
    }
  };

  const unlockArea = async (area: string) => {
    const password = unlockDraft[area] ?? '';
    if (!password) return;
    setBusy(`unlock:${area}`);
    setMsg(null);
    try {
      const res = await api.post<{ ticket: string; expiresAt: string }>(`/dashboard/vault/areas/${area}/unlock`, { password });
      setAreaTicket(area, res);
      setMsg({ ok: true, text: t('vault.msg.unlocked') });
      setUnlockDraft((d) => ({ ...d, [area]: '' }));
    } catch {
      setMsg({ ok: false, text: t('vault.msg.wrongPw') });
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
        setMsg({ ok: false, text: t('vault.passkey.unsupported') });
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
        setMsg({ ok: false, text: t('vault.passkey.unsupported') });
        return;
      }
      const spki = cred.response.getPublicKey();
      if (!spki) {
        setMsg({ ok: false, text: t('vault.passkey.unsupported') });
        return;
      }
      await api.post('/dashboard/vault/passkeys/register/finish', {
        challengeId: begin.challengeId,
        credentialId: cred.id,
        publicKeyB64: btoa(String.fromCharCode(...new Uint8Array(spki))),
        deviceLabel: /Mobile|Android|iPhone/.test(navigator.userAgent) ? tx('گوشی', 'Phone') : tx('رایانه', 'Computer'),
      });
      setMsg({ ok: true, text: t('vault.msg.passkeyAdded') });
      await refresh();
    } catch {
      setMsg({ ok: false, text: t('vault.passkey.cancelled') });
    } finally {
      setBusy(null);
    }
  };

  /* ---------- rotation ---------- */
  const rotateAll = async () => {
    setBusy('rotate');
    setMsg(null);
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
      setMsg({ ok: true, text: t('vault.msg.rotated') });
      await refresh();
    } catch (e) {
      setMsg({ ok: false, text: errText(e, tx('نوسازی انجام نشد.', 'Renewal failed.')) });
    } finally {
      setBusy(null);
    }
  };

  const en = getPrefs().locale === 'en';
  const tokensApplicable = advice.find((a) => a.key === 'machine-tokens')?.status !== 'not_applicable';

  return (
    <section className="grid" style={{ gap: 14, marginTop: 6 }}>
      <h3 className="title-row" style={{ margin: 0 }}><KeyRound size={18} aria-hidden="true" />{t('vault.title')}</h3>
      {msg && <p className={msg.ok ? 'form-ok' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}

      <div className="card">
        <h4 className="sub-head">{t('vault.locks.title')}</h4>
        <p className="hint">
          {tx(
            'برای بخش‌های حساس رمزی جدا از ورود بگذارید. حتی اگر کسی به نشست باز شما دسترسی پیدا کند، بدون این رمز وارد این بخش‌ها نمی‌شود. تغییر یا حذف رمز هم رمز فعلی را لازم دارد.',
            'Give sensitive sections a password separate from sign-in. Even someone with access to your open session cannot enter them without it. Changing or removing the password also needs the current one.',
          )}
        </p>
        <div className="list">
          {areas.map((a) => {
            const unlocked = a.locked && Boolean(getAreaTicket(a.area));
            return (
              <div key={a.area} className="list-item">
                <div className="list-title">
                  {a.locked ? <Lock size={16} className="ok-text" aria-hidden="true" /> : <LockOpen size={16} className="dim" aria-hidden="true" />}
                  <b style={{ flex: 1 }}>{areaLabel(a.area)}</b>
                  {a.locked ? (
                    <span className={`pill ${unlocked ? 'teal' : 'ok'}`}>{unlocked ? t('vault.locks.ticketAlive') : tx('قفل', 'Locked')}</span>
                  ) : (
                    <span className="pill">{tx('بدون رمز', 'No password')}</span>
                  )}
                </div>
                {a.updatedAt && (
                  <div className="list-meta">{tx('آخرین تغییر: ', 'Last changed: ')}{new Date(a.updatedAt).toLocaleDateString(dateLocale())}</div>
                )}
                <form
                  className="inline-form"
                  style={{ marginTop: 10, flexWrap: 'wrap' }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!a.locked) void setAreaPw(a.area);
                    else if (changing === a.area) void setAreaPw(a.area, unlockDraft[a.area] ?? '');
                    else void unlockArea(a.area);
                  }}
                >
                  {a.locked ? (
                    <>
                      <input
                        type="password"
                        className="text-input"
                        autoComplete="current-password"
                        aria-label={changing === a.area ? tx('رمز فعلی', 'Current password') : t('vault.locks.unlockPh')}
                        placeholder={changing === a.area ? tx('رمز فعلی', 'Current password') : t('vault.locks.unlockPh')}
                        value={unlockDraft[a.area] ?? ''}
                        onChange={(e) => setUnlockDraft((d) => ({ ...d, [a.area]: e.target.value }))}
                      />
                      {changing === a.area ? (
                        <>
                          <input
                            type="password"
                            className="text-input"
                            autoComplete="new-password"
                            aria-label={t('vault.locks.newPw')}
                            placeholder={t('vault.locks.newPw')}
                            value={pwDraft[a.area] ?? ''}
                            onChange={(e) => setPwDraft((d) => ({ ...d, [a.area]: e.target.value }))}
                          />
                          <button type="submit" className="btn primary small" disabled={busy !== null}>{tx('ذخیرهٔ رمز جدید', 'Save new password')}</button>
                          <button type="button" className="btn ghost small" onClick={() => setChanging(null)}>{tx('انصراف', 'Cancel')}</button>
                        </>
                      ) : (
                        <>
                          <button type="submit" className="btn small" disabled={busy !== null}>{t('vault.locks.unlock')}</button>
                          <button type="button" className="btn ghost small" disabled={busy !== null} onClick={() => setChanging(a.area)}>{tx('تغییر رمز', 'Change')}</button>
                          <button type="button" className="btn ghost small" disabled={busy !== null} onClick={() => void disableArea(a.area)}>{t('vault.locks.disable')}</button>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <input
                        type="password"
                        className="text-input"
                        autoComplete="new-password"
                        minLength={8}
                        aria-label={t('vault.locks.newPw')}
                        placeholder={t('vault.locks.newPw')}
                        value={pwDraft[a.area] ?? ''}
                        onChange={(e) => setPwDraft((d) => ({ ...d, [a.area]: e.target.value }))}
                      />
                      <button type="submit" className="btn small" disabled={busy !== null}>{t('vault.locks.set')}</button>
                    </>
                  )}
                </form>
              </div>
            );
          })}
        </div>
        <p className="hint" style={{ marginTop: 10, fontSize: 12 }}>
          {tx(
            'رمز بخش را فراموش کرده‌اید؟ راه بازنشانی از روی سرور در راهنمای عملیات (docs/RUNBOOK.md) آمده است.',
            'Forgot a section password? The server-side reset is described in the operations runbook (docs/RUNBOOK.md).',
          )}
        </p>
      </div>

      <div className="card">
        <h4 className="sub-head title-row"><Fingerprint size={16} aria-hidden="true" />{t('vault.passkey.title')}</h4>
        <p className="hint">{t('vault.passkey.hint')}</p>
        {webauthnSupport === false && <p className="form-error">{t('vault.passkey.unsupported')}</p>}
        {passkeys.length === 0 ? (
          <p className="empty-line">{t('vault.passkey.none')}</p>
        ) : (
          <div className="list">
            {passkeys.map((p) => (
              <div key={p.credentialId} className="list-item row">
                <Fingerprint size={16} aria-hidden="true" />
                <b>{p.deviceLabel}</b>
                <span className="dim" style={{ fontSize: 12 }}>{new Date(p.createdAt).toLocaleDateString(dateLocale())}</span>
                <span className="dim" style={{ fontSize: 12 }}>{t('vault.passkey.uses')} {num(p.counter)}</span>
              </div>
            ))}
          </div>
        )}
        <button className="btn small" style={{ marginTop: 10 }} disabled={busy === 'passkey' || webauthnSupport === false} onClick={() => void registerPasskey()}>
          {busy === 'passkey' ? tx('در انتظار دستگاه…', 'Waiting for the device…') : t('vault.passkey.add')}
        </button>
      </div>

      <div className="card">
        <h4 className="sub-head">{t('vault.rotation.title')}</h4>
        <div className="list">
          {advice.map((a) => (
            <div key={a.key} className="list-item">
              <div className="list-title">
                {adviceBadge(a)}
                <b style={{ flex: 1 }}>{adviceLabel(a.key)}</b>
                {a.ageDays !== null && (
                  <span className="dim" style={{ fontSize: 12 }}>
                    {tx(`${num(a.ageDays)} از ${num(a.maxAgeDays)} روز`, `${num(a.ageDays)} of ${num(a.maxAgeDays)} days`)}
                  </span>
                )}
              </div>
              <p className="hint" style={{ margin: '4px 0 0' }}>{en ? (a.hintEn ?? a.hintFa) : a.hintFa}</p>
            </div>
          ))}
        </div>
        <button className="btn small" style={{ marginTop: 10 }} disabled={busy === 'rotate' || !tokensApplicable} onClick={() => void rotateAll()}>
          <RefreshCw size={15} aria-hidden="true" />
          {busy === 'rotate' ? tx('در حال نوسازی…', 'Renewing…') : t('vault.rotation.rotateAll')}
        </button>
        <p className="hint" style={{ marginTop: 8, fontSize: 12 }}>{t('vault.rotation.note')}</p>
      </div>
    </section>
  );
}
