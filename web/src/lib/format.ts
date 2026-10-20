import i18n from '../i18n';

const locale = () => (i18n.resolvedLanguage === 'nl' ? 'nl-NL' : (i18n.resolvedLanguage ?? 'en'));

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—';

export function timeAgo(iso: string) {
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  let v = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['second', 60], ['minute', 60], ['hour', 24], ['day', 30], ['month', 12], ['year', Infinity]];
  for (const [unit, size] of steps) {
    if (Math.abs(v) < size) return rtf.format(Math.round(v), unit);
    v /= size;
  }
  return formatDate(iso);
}

export function formatDuration(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? i18n.t('time.days', { d, h }) : h ? i18n.t('time.hours', { h, m }) : i18n.t('time.minutes', { m });
}

export const formatMoney = (cents: number, currency = 'EUR') => new Intl.NumberFormat(locale(), { style: 'currency', currency }).format(cents / 100);

/** A calendar date (YYYY-MM-DD) without time-zone shifts. */
export function formatDay(iso: string | null | undefined) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
}

/** "12,50" or "12.50" → 1250 */
export const parseMoney = (v: string) => Math.round(Number(v.trim().replace(/\s/g, '').replace(',', '.')) * 100);
export const centsInput = (cents: number) => (cents / 100).toFixed(2);
