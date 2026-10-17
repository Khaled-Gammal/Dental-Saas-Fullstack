import { t, type Lang } from '../../i18n';
import { fmtNumber } from '../../util';

/** Piastres as "1,250.50 ج.م" (whole pounds without decimals). The currency setting itself waits for CLR-09. */
export function money(minor: number, lang: Lang): string {
  const pounds = minor / 100;
  const n = Number.isInteger(pounds) ? fmtNumber(pounds, lang) : pounds.toLocaleString(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n} ${t('egp', lang)}`;
}
