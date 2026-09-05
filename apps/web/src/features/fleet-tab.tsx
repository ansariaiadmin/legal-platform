'use client';

import { useEffect, useState } from 'react';
import { t, getPrefs } from '@/i18n';
import { api, type FleetAgent } from '@/lib/api';

interface ModelRow {
  agentId: string;
  persona: string;
  personaEn: string | null;
  mottoEn: string | null;
  assignment: { target: string; model: string } | null;
  lending: { source: string; meaning: string } | null;
}

const AVATAR: Record<string, string> = {
  'civil-expert': '📜',
  'criminal-expert': '⚔️',
  'family-expert': '👨‍👩‍👧',
  'registration-expert': '🖋️',
  'legal-expert-base': '🧭',
};

export function FleetTab() {
  const [agents, setAgents] = useState<FleetAgent[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [fleet, matrix] = await Promise.all([
          api.get<{ agents: FleetAgent[] }>('/dashboard/orchestrator/fleet'),
          api.get<{ agents: ModelRow[] }>('/dashboard/orchestrator/models'),
        ]);
        setAgents(fleet.agents);
        setModels(matrix.agents);
      } catch {
        setError(true);
      }
    })();
  }, []);

  if (error) {
    return <div className="card"><p className="hint">اتصال برقرار نشد — ورود کرده‌ای؟ API بالاست؟</p></div>;
  }

  return (
    <div className="grid cols-2">
      {agents.map((a) => {
        const m = models.find((x) => x.agentId === a.agentId);
        return (
          <div key={a.agentId} className="card">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ fontSize: 34 }}>{AVATAR[a.agentId] ?? '🤖'}</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0 }}>{(getPrefs().locale === 'en' && a.personaEn) ? a.personaEn : a.persona}</h3>
                <small style={{ color: 'var(--text-dim)' }}>{(getPrefs().locale === 'en' && a.mottoEn) ? a.mottoEn : a.motto}</small>
              </div>
              {a.disabled
                ? <span className="pill bad">{t('fleet.disabled')}</span>
                : a.healthy
                  ? <span className="pill ok">{t('fleet.healthy')}</span>
                  : <span className="pill bad">⚠️</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0 8px' }}>
              {a.skills.map((s) => <span key={s} className="pill">{s}</span>)}
            </div>
            <div className="kv"><b>گرنت‌های فعال</b><span>{a.activeGrants}</span></div>
            <div className="kv">
              <b>مغز</b>
              <span>
                {m?.assignment
                  ? `${m.assignment.target} — ${m.assignment.model}`
                  : `❝ ${t('fleet.lends')} ❞`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
