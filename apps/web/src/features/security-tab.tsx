'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, MinusCircle, ShieldCheck, XCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { dateLocale, getPrefs, num, t, tx } from '@/i18n';
import { VaultPanel } from './vault-panel';

interface Posture {
  scanned: boolean;
  postureScore?: number;
  at?: string;
  passed?: number;
  warned?: number;
  failed?: number;
  applicableChecks?: number;
  standardsVersion?: string;
}

interface CheckResult {
  checkId: string;
  status: 'pass' | 'warn' | 'fail' | 'not_applicable';
  evidence: string;
  remediationFa: string | null;
  remediationEn?: string | null;
}

interface StandardDef {
  id: string;
  standardRefs: string[];
  titleFa: string;
  titleEn: string;
  severity: string;
  weight: number;
}

interface FullReport {
  reportId: string;
  at: string;
  postureScore: number;
  results: CheckResult[];
  deltas: { improved: string[]; regressed: string[] };
}

function statusBadge(status: CheckResult['status']) {
  switch (status) {
    case 'pass':
      return <span className="pill ok"><CheckCircle2 size={13} aria-hidden="true" />{tx('برقرار', 'Pass')}</span>;
    case 'warn':
      return <span className="pill gold"><AlertTriangle size={13} aria-hidden="true" />{tx('هشدار', 'Warning')}</span>;
    case 'fail':
      return <span className="pill bad"><XCircle size={13} aria-hidden="true" />{tx('ناموفق', 'Fail')}</span>;
    default:
      return <span className="pill"><MinusCircle size={13} aria-hidden="true" />{tx('نامرتبط', 'N/A')}</span>;
  }
}

export function SecurityTab() {
  const [posture, setPosture] = useState<Posture | null>(null);
  const [standards, setStandards] = useState<StandardDef[]>([]);
  const [report, setReport] = useState<FullReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, s, r] = await Promise.all([
        api.get<Posture>('/dashboard/security/posture'),
        api.get<{ standards: StandardDef[] }>('/dashboard/security/standards'),
        api.get<{ report: FullReport | null }>('/dashboard/security/reports/latest'),
      ]);
      setPosture(p);
      setStandards(s.standards);
      setReport(r.report);
    } catch {
      /* first paint; the scan button reports errors */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runScan = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/dashboard/security/scan', {});
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const en = getPrefs().locale === 'en';
  const score = posture?.postureScore ?? null;
  const byId = new Map(report?.results.map((r) => [r.checkId, r]) ?? []);
  const titleOf = (id: string) => {
    const def = standards.find((d) => d.id === id);
    return def ? (en ? def.titleEn : def.titleFa) : id;
  };
  const scorePct = score === null ? 0 : (score / 10) * 100;
  const scoreTone = score === null ? 'var(--text-dim)' : score >= 9 ? 'var(--ok)' : score >= 7 ? 'var(--gold)' : 'var(--bad)';

  return (
    <section className="grid" style={{ gap: 14 }}>
      <div className="card security-score">
        <div className="score-figure">
          <div style={{ fontSize: 44, fontWeight: 800, color: scoreTone, lineHeight: 1.2 }}>
            {posture === null ? <Skeleton width={48} height={34} /> : score === null ? '—' : num(score)}
            <span style={{ fontSize: 18, color: 'var(--text-dim)' }}> / {num(10)}</span>
          </div>
          <div className="hint" style={{ margin: 0 }}>{t('security.posture')}</div>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="meter" aria-hidden="true">
            <i style={{ width: `${scorePct}%`, background: scoreTone }} />
          </div>
          <p className="hint" style={{ margin: '8px 0 0' }}>
            {posture?.scanned
              ? tx(
                  `${t('security.lastScan')}: ${new Date(posture.at ?? '').toLocaleString(dateLocale())} · ${num(posture.passed ?? 0)} برقرار، ${num(posture.warned ?? 0)} هشدار، ${num(posture.failed ?? 0)} ناموفق`,
                  `${t('security.lastScan')}: ${new Date(posture.at ?? '').toLocaleString(dateLocale())} · ${num(posture.passed ?? 0)} passed, ${num(posture.warned ?? 0)} warnings, ${num(posture.failed ?? 0)} failed`,
                )
              : t('security.neverScanned')}
          </p>
          {posture?.standardsVersion && (
            <p className="hint" style={{ margin: '4px 0 0', fontSize: 12 }}>
              {t('security.standardsVersion')}: <span dir="ltr">{posture.standardsVersion}</span>
            </p>
          )}
        </div>
        <button className="btn" onClick={() => void runScan()} disabled={busy}>
          <ShieldCheck size={16} aria-hidden="true" />
          {busy ? tx('در حال بررسی…', 'Checking…') : t('security.rescan')}
        </button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {report && (report.deltas.regressed.length > 0 || report.deltas.improved.length > 0) && (
        <div className="card">
          {report.deltas.regressed.length > 0 && (
            <p className="bad-text" style={{ margin: 0 }}>
              {t('security.regressed')}: {report.deltas.regressed.map(titleOf).join(tx('، ', ', '))}
            </p>
          )}
          {report.deltas.improved.length > 0 && (
            <p className="ok-text" style={{ margin: 0 }}>
              {t('security.improved')}: {report.deltas.improved.map(titleOf).join(tx('، ', ', '))}
            </p>
          )}
        </div>
      )}

      <div className="card">
        <h3>{tx('کنترل‌ها', 'Controls')}</h3>
        <div className="list">
          {standards.map((def) => {
            const r = byId.get(def.id);
            const fix = r ? (en ? (r.remediationEn ?? r.remediationFa) : r.remediationFa) : null;
            return (
              <div key={def.id} className="list-item">
                <div className="list-title">
                  {statusBadge(r?.status ?? 'not_applicable')}
                  <b style={{ flex: 1, fontSize: 14 }}>{en ? def.titleEn : def.titleFa}</b>
                </div>
                <div className="list-meta">
                  <span dir="ltr">{def.standardRefs.join(' · ')}</span>
                </div>
                {!r && <p className="hint" style={{ margin: '6px 0 0' }}>{t('security.notScannedYet')}</p>}
                {r && r.status !== 'pass' && fix && <p className="warn-text" style={{ margin: '6px 0 0', display: 'block' }}>{fix}</p>}
                {r && (
                  <details className="reveal compact">
                    <summary>{tx('جزئیات فنی', 'Technical detail')}</summary>
                    <code dir="ltr" style={{ fontSize: 11.5, whiteSpace: 'pre-wrap' }}>{r.evidence}</code>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <VaultPanel />
    </section>
  );
}
