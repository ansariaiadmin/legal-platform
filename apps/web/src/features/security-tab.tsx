'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t } from '@/i18n';

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

const STATUS_STYLE: Record<CheckResult['status'], { cls: string; label: string }> = {
  pass: { cls: 'pill ok', label: '✓' },
  warn: { cls: 'pill gold', label: '⚠' },
  fail: { cls: 'pill bad', label: '✗' },
  not_applicable: { cls: 'pill', label: '—' },
};

export function SecurityTab() {
  const [posture, setPosture] = useState<Posture | null>(null);
  const [standards, setStandards] = useState<StandardDef[]>([]);
  const [report, setReport] = useState<FullReport | null>(null);
  const [busy, setBusy] = useState(false);

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
      /* first paint */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runScan = async () => {
    setBusy(true);
    try {
      await api.post('/dashboard/security/scan', {});
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const score = posture?.postureScore ?? null;
  const byId = new Map(report?.results.map((r) => [r.checkId, r]) ?? []);
  const scorePct = score === null ? 0 : (score / 10) * 100;
  const scoreTone = score === null ? '' : score >= 9 ? 'var(--ok)' : score >= 7 ? 'var(--gold)' : 'var(--bad)';

  return (
    <section>
      <h3>{t('security.title')}</h3>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 44, fontWeight: 800, color: scoreTone || 'var(--muted)' }}>
            {score === null ? '—' : score}
            <span style={{ fontSize: 18, color: 'var(--muted)' }}>/10</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('security.posture')}</div>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ height: 10, background: 'rgba(0,0,0,0.3)', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ width: `${scorePct}%`, height: '100%', background: scoreTone || 'var(--line)', transition: 'width 400ms' }} />
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--muted)' }}>
            {posture?.scanned
              ? `${t('security.lastScan')}: ${new Date(posture.at ?? '').toLocaleString('fa-IR')} — ${posture.passed}✓ / ${posture.warned}⚠ / ${posture.failed}✗`
              : t('security.neverScanned')}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--muted)' }}>
            {posture?.standardsVersion && `${t('security.standardsVersion')}: ${posture.standardsVersion}`}
          </div>
        </div>
        <button className="pill teal" onClick={() => void runScan()} disabled={busy} style={{ cursor: 'pointer' }}>
          {busy ? '…' : t('security.rescan')}
        </button>
      </div>

      {report && (report.deltas.regressed.length > 0 || report.deltas.improved.length > 0) && (
        <div className="card" style={{ marginTop: 12 }}>
          {report.deltas.regressed.length > 0 && (
            <div style={{ color: 'var(--bad)', fontSize: 13 }}>
              {t('security.regressed')}: {report.deltas.regressed.join('، ')}
            </div>
          )}
          {report.deltas.improved.length > 0 && (
            <div style={{ color: 'var(--ok)', fontSize: 13 }}>
              {t('security.improved')}: {report.deltas.improved.join('، ')}
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 12 }}>
              <th style={{ padding: 6 }}>{t('security.check')}</th>
              <th style={{ padding: 6 }}>{t('security.refs')}</th>
              <th style={{ padding: 6 }}>{t('security.status')}</th>
              <th style={{ padding: 6 }}>{t('security.evidence')}</th>
            </tr>
          </thead>
          <tbody>
            {standards.map((def) => {
              const r = byId.get(def.id);
              const st = STATUS_STYLE[r?.status ?? 'not_applicable'];
              return (
                <tr key={def.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: 8 }}>
                    <div>{def.titleFa}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{def.titleEn}</div>
                  </td>
                  <td style={{ padding: 8, fontSize: 11, color: 'var(--muted)', direction: 'ltr', textAlign: 'left' }}>
                    {def.standardRefs.join(' · ')}
                  </td>
                  <td style={{ padding: 8 }}>
                    <span className={st.cls}>{st.label}</span>
                  </td>
                  <td style={{ padding: 8, fontSize: 11, color: 'var(--muted)' }}>
                    {r?.evidence ?? t('security.notScannedYet')}
                    {r?.remediationFa && (
                      <div style={{ color: 'var(--gold)', marginTop: 2 }}>🛠 {r.remediationFa}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
