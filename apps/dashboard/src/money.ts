import { t, type Lang } from './i18n';
import { fmtNumber } from './util';

/**
 * Minor units as "1,250.50 ج.م" in the clinic currency (CLR-09; whole amounts without decimals). EGP shows its Arabic
 * symbol; another currency shows its ISO code. Stored values are never changed by display.
 */
export function money(minor: number, lang: Lang, currency = 'EGP'): string {
  const major = minor / 100;
  const n = Number.isInteger(major) ? fmtNumber(major, lang) : major.toLocaleString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n} ${currency === 'EGP' ? t('egp', lang) : currency}`;
}
