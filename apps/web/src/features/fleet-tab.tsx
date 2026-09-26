'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { AgentIcon } from '@/components/agent-icon';
import { t, getPrefs, num, tx } from '@/i18n';
import { api, type FleetAgent } from '@/lib/api';
import { skillLabel } from '@/lib/skills';

interface ModelRow {
  agentId: string;
  persona: string;
  personaEn: string | null;
  mottoEn: string | null;
  assignment: { target: string; model: string } | null;
  lending: { source: string; meaning: string } | null;
}

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
    return <div className="card"><p className="form-error" role="alert">{tx('اطلاعات دستیاران دریافت نشد. دوباره وارد شوید یا وضعیت سرور را بررسی کنید.', 'Could not load the assistants. Sign in again or check the server status.')}</p></div>;
  }

  return (
    <div className="grid cols-2">
      {agents.map((a) => {
        const m = models.find((x) => x.agentId === a.agentId);
        return (
          <div key={a.agentId} className="card">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="jump-icon"><AgentIcon agentId={a.agentId} /></span>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0 }}>{(getPrefs().locale === 'en' && a.personaEn) ? a.personaEn : a.persona}</h3>
                <small style={{ color: 'var(--text-dim)' }}>{(getPrefs().locale === 'en' && a.mottoEn) ? a.mottoEn : a.motto}</small>
              </div>
              {a.disabled
                ? <span className="pill bad">{t('fleet.disabled')}</span>
                : a.healthy
                  ? <span className="pill ok">{t('fleet.healthy')}</span>
                  : <span className="pill bad"><AlertTriangle size={12} aria-hidden="true" />{tx('نیازمند بررسی', 'Needs attention')}</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0 8px' }}>
              {a.skills.map((s) => <span key={s} className="pill">{skillLabel(s, getPrefs().locale)}</span>)}
            </div>
            <div className="kv"><b>{tx('مجوزهای فعال', 'Active permissions')}</b><span>{num(a.activeGrants)}</span></div>
            <div className="kv">
              <b>{tx('مدل', 'Model')}</b>
              <span>
                {m?.assignment ? <span dir="ltr">{`${m.assignment.target} — ${m.assignment.model}`}</span> : t('fleet.lends')}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
