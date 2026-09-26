/**
 * Product identity and attribution — the single source of truth for the UI.
 *
 * Attribution notice (AGPL-3.0 section 7(b)): the author credit and the
 * legal notices rendered from this file are "Appropriate Legal Notices".
 * Redistributed or modified versions must keep them visible. See NOTICE and
 * TRADEMARKS.md at the repository root.
 */
export const BRAND = {
  nameFa: 'پلتفرم حقوقی',
  nameEn: 'Legal Platform',
  version: '1.0.0',
  author: 'Mohammad Ansari',
  authorFa: 'محمد انصاری',
  copyrightYear: '2026',
  website: 'https://ansariai.ir',
  telegram: '@ansariaiadmin',
  telegramUrl: 'https://t.me/ansariaiadmin',
  sourceUrl: 'https://github.com/ansariaiadmin/legal-platform',
  license: 'AGPL-3.0-or-later',
  licenseUrl: 'https://www.gnu.org/licenses/agpl-3.0.html',
  /**
   * Donation page. Empty until a page is published; the UI then shows
   * «به‌زودی» / "coming soon" instead of a link. Set this one value only.
   */
  donationUrl: '',
} as const;
