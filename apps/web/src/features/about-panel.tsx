'use client';

import { useEffect } from 'react';
import { t } from '@/i18n';
import { BRAND } from '@/lib/brand';

/**
 * «درباره» — product, author, license and support links.
 * The legal notices here must stay visible in redistributed versions
 * (AGPL-3.0 section 7(b); see NOTICE).
 */
export function AboutPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="about-backdrop" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={onClose}>
      <div className="card about-card" onClick={(e) => e.stopPropagation()}>
        <div className="about-head">
          <img src="/icon.svg" alt="" width={48} height={48} />
          <div>
            <h3 id="about-title">{t('app.name')}</h3>
            <small>
              {t('about.version')} {BRAND.version}
            </small>
          </div>
        </div>

        <p className="hint">{t('about.summary')}</p>

        <dl className="about-list">
          <dt>{t('about.author')}</dt>
          <dd>{t('about.authorName')}</dd>
          <dt>{t('about.website')}</dt>
          <dd>
            <a href={BRAND.website} target="_blank" rel="noopener noreferrer" dir="ltr">
              ansariai.ir
            </a>
          </dd>
          <dt>{t('about.contact')}</dt>
          <dd>
            <a href={BRAND.telegramUrl} target="_blank" rel="noopener noreferrer" dir="ltr">
              {BRAND.telegram}
            </a>
            <div className="about-sub">{t('about.contactNote')}</div>
          </dd>
          <dt>{t('about.license')}</dt>
          <dd>
            <a href={BRAND.licenseUrl} target="_blank" rel="noopener noreferrer" dir="ltr">
              GNU AGPL-3.0
            </a>
            <div className="about-sub">{t('about.licenseNote')}</div>
          </dd>
          <dt>{t('about.source')}</dt>
          <dd>
            <a href={BRAND.sourceUrl} target="_blank" rel="noopener noreferrer" dir="ltr">
              github.com/ansariaiadmin/legal-platform
            </a>
          </dd>
          <dt>{t('about.donate')}</dt>
          <dd>
            {BRAND.donationUrl ? (
              <a href={BRAND.donationUrl} target="_blank" rel="noopener noreferrer">
                {t('about.donateCta')}
              </a>
            ) : (
              <span>{t('about.soon')}</span>
            )}
            <div className="about-sub">{t('about.donateNote')}</div>
          </dd>
        </dl>

        <p className="about-legal">
          © {BRAND.copyrightYear} {BRAND.author}. {t('about.warranty')}
        </p>

        <button className="btn primary" onClick={onClose} autoFocus>
          {t('about.close')}
        </button>
      </div>
    </div>
  );
}

/** Footer with the Appropriate Legal Notices (AGPL-3.0 section 0). */
export function LegalFooter({ onAbout }: { onAbout: () => void }) {
  return (
    <footer className="legal-footer">
      <a href={BRAND.website} target="_blank" rel="noopener noreferrer">
        {t('about.attribution')}
      </a>
      <span aria-hidden="true">·</span>
      <a href={BRAND.licenseUrl} target="_blank" rel="noopener noreferrer">
        AGPL-3.0
      </a>
      <span aria-hidden="true">·</span>
      <a href={BRAND.sourceUrl} target="_blank" rel="noopener noreferrer">
        {t('about.source')}
      </a>
      <span aria-hidden="true">·</span>
      <button type="button" className="linklike" onClick={onAbout}>
        {t('about.title')}
      </button>
    </footer>
  );
}
