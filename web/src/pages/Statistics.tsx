import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, BarChart3, Building2, Download, FileText, Radio, Search, Smartphone, UserCheck, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Segmented } from '../components/controls';
import { Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, Select, Spinner, cx } from '../components/ui';
import i18n, { currentLocale } from '../i18n';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';

type Granularity = 'day' | 'week' | 'month';
type Totals = { guests: number; uniqueDevices: number; registrations: number; activeTenants: number; vouchersUsed: number; paidSessions: number };
type Stats = {
  from: string;
  to: string;
  days: number;
  granularity: Granularity;
  previous: { from: string; to: string } & Totals;
  totals: Totals & {
    newDevices: number;
    returningDevices: number;
    marketingOptIns: number;
    tenants: number;
    newTenants: number;
    resellers: number;
    activeAdmins: number;
    onlineNow: number;
    guestPayments: number;
    guestRevenue: { currency: string; cents: number }[];
  };
  series: { bucket: string; guests: number; devices: number; tenants: number }[];
  previousSeries: number[];
  heatmap: number[][];
  byMethod: Record<string, number>;
  byReseller: { id: string | null; name: string; tenants: number; activeTenants: number; guests: number; devices: number; previousGuests: number }[];
  byTenant: { id: string; name: string; status: string; resellerId: string | null; resellerName: string | null; guests: number; devices: number; registrations: number; previousGuests: number; lastGuestAt: string | null }[];
  peak: { weekday: number; hour: number; count: number } | null;
  busiestDay: { bucket: string; count: number } | null;
};
type Options = { resellers: { id: string; name: string }[]; tenants: { id: string; name: string; resellerId: string | null }[] };

type Preset = '7d' | '30d' | '90d' | '12m' | 'ytd' | 'custom';
const PRESETS: Preset[] = ['7d', '30d', '90d', '12m', 'ytd', 'custom'];

const loc = () => (i18n.resolvedLanguage === 'nl' ? 'nl-NL' : 'en-GB');
const num = (v: number) => new Intl.NumberFormat(loc()).format(v);
const pct = (v: number) => new Intl.NumberFormat(loc(), { style: 'percent', maximumFractionDigits: v < 0.1 ? 1 : 0 }).format(v);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const utc = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const dayLabel = (day: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat(loc(), { ...opts, timeZone: 'UTC' }).format(utc(day));
// 2024-01-01 was a Monday
const weekday = (i: number, style: 'long' | 'short' = 'long') => new Intl.DateTimeFormat(loc(), { weekday: style, timeZone: 'UTC' }).format(Date.UTC(2024, 0, 1 + i));
const change = (now: number, before: number) => (before ? (now - before) / before : null);

function presetRange(p: Preset): { from: string; to: string } | null {
  const today = new Date();
  const back = (days: number) => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days));
  switch (p) {
    case '7d':
      return { from: back(6), to: iso(today) };
    case '30d':
      return { from: back(29), to: iso(today) };
    case '90d':
      return { from: back(89), to: iso(today) };
    case '12m':
      return { from: iso(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1)), to: iso(today) };
    case 'ytd':
      return { from: `${today.getFullYear()}-01-01`, to: iso(today) };
    default:
      return null;
  }
}

function bucketLabel(bucket: string, g: Granularity, long = false) {
  if (g === 'month') return dayLabel(bucket, { month: long ? 'long' : 'short', year: 'numeric' });
  if (g === 'week') return long ? `${dayLabel(bucket, { day: 'numeric', month: 'short' })} – ${dayLabel(new Date(utc(bucket) + 6 * 864e5).toISOString().slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })}` : dayLabel(bucket);
  return long ? dayLabel(bucket, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : dayLabel(bucket);
}

/** Width of an element, following resizes, so charts draw crisp text at any size. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function Delta({ value }: { value: number | null }) {
  const { t } = useTranslation();
  if (value === null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  return (
    <p className="mt-1 flex items-center gap-1 text-xs">
      <span className={cx('inline-flex items-center gap-0.5 font-semibold', up ? 'text-online' : 'text-offline')}>
        {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
        {pct(Math.abs(value))}
      </span>
      <span className="text-muted">{t('stats.vsPrevious')}</span>
    </p>
  );
}

function Kpi({ icon, label, value, sub, delta, live }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; delta?: number | null; live?: boolean }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <span className="grid size-10 place-items-center rounded-xl bg-koraal/12 text-accent">{icon}</span>
        {live && (
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-online opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-online" />
          </span>
        )}
      </div>
      <p className="display mt-4 text-2xl tabular-nums sm:text-3xl">{value}</p>
      <p className="text-sm text-muted">{label}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
      {delta !== undefined && <Delta value={delta} />}
    </Card>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-raised px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

/** Area chart of one measure with the previous period as a dashed line; crosshair + tooltip on hover. */
function TrendChart({ series, previous, granularity, metric }: { series: Stats['series']; previous: number[]; granularity: Granularity; metric: 'guests' | 'devices' | 'tenants' }) {
  const { t } = useTranslation();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 260;
  const pad = { top: 16, right: 12, bottom: 28, left: 44 };
  const values = series.map((s) => s[metric]);
  const prev = metric === 'guests' ? previous.slice(-values.length) : [];
  const rawMax = Math.max(1, ...values, ...prev);
  // A rounded top for the axis: 1, 2 or 5 × 10^n
  const mag = 10 ** Math.floor(Math.log10(rawMax));
  const max = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= rawMax) ?? rawMax;
  const iw = Math.max(1, width - pad.left - pad.right);
  const ih = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (values.length <= 1 ? iw / 2 : (i / (values.length - 1)) * iw);
  const y = (v: number) => pad.top + ih - (v / max) * ih;
  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = values.length ? `${line(values)}L${x(values.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : '';
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.max(1, Math.ceil(values.length / Math.max(2, Math.floor(iw / 80))));

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - box.left) / box.width;
    setHover(Math.max(0, Math.min(values.length - 1, Math.round(rel * (values.length - 1)))));
  };
  const label = { guests: t('stats.guests'), devices: t('stats.devices'), tenants: t('stats.activeTenants') }[metric];

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${label}: ${series.map((s, i) => `${bucketLabel(s.bucket, granularity)} ${values[i]}`).join(', ')}`}>
          <defs>
            <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--koraal)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--koraal)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.left} x2={pad.left + iw} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={v ? '2 4' : undefined} />
              <text x={pad.left - 8} y={y(v) + 4} textAnchor="end" className="fill-[var(--ink-muted)] text-[11px] tabular-nums">
                {num(v)}
              </text>
            </g>
          ))}
          {series.map((s, i) =>
            i % every === 0 ? (
              <text key={s.bucket} x={x(i)} y={height - 8} textAnchor={i === 0 && values.length > 1 ? 'start' : x(i) > pad.left + iw - 40 ? 'end' : 'middle'} className="fill-[var(--ink-muted)] text-[11px]">
                {bucketLabel(s.bucket, granularity)}
              </text>
            ) : null,
          )}
          <path d={area} fill="url(#trend-fill)" />
          {prev.length > 1 && <path d={line(prev)} fill="none" stroke="var(--ink-muted)" strokeOpacity="0.6" strokeWidth="1.5" strokeDasharray="4 4" />}
          <path d={line(values)} fill="none" stroke="var(--koraal)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + ih} stroke="var(--ink-muted)" strokeOpacity="0.5" />
              {prev[hover] !== undefined && <circle cx={x(hover)} cy={y(prev[hover])} r="4" fill="var(--surface-raised)" stroke="var(--ink-muted)" strokeWidth="2" />}
              <circle cx={x(hover)} cy={y(values[hover])} r="5" fill="var(--koraal)" stroke="var(--surface-raised)" strokeWidth="2" />
            </g>
          )}
          <rect x={pad.left} y={pad.top} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
      )}
      {hover !== null && series[hover] && (
        <div
          className="pointer-events-none absolute z-10 min-w-[160px] rounded-xl border border-line bg-raised px-3 py-2 text-xs shadow-card"
          style={{ left: Math.min(Math.max(0, x(hover) - 80), width - 170), top: 0 }}
        >
          <p className="mb-1 font-semibold">{bucketLabel(series[hover].bucket, granularity, true)}</p>
          <p className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="h-0.5 w-3 rounded bg-koraal" />
              {label}
            </span>
            <span className="font-semibold tabular-nums">{num(values[hover])}</span>
          </p>
          {prev[hover] !== undefined && (
            <p className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted">
                <span className="w-3 border-t-2 border-dashed border-muted" />
                {t('stats.previousPeriod')}
              </span>
              <span className="font-semibold tabular-nums">{num(prev[hover])}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Weekday × hour grid in one hue, light to dark; totals per hour above and per weekday on the right. */
function Heatmap({ data }: { data: number[][] }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const max = Math.max(1, ...data.flat());
  const hours = Array.from({ length: 24 }, (_, h) => data.reduce((s, row) => s + row[h], 0));
  const days = data.map((row) => row.reduce((s, v) => s + v, 0));
  const hourMax = Math.max(1, ...hours);
  const dayMax = Math.max(1, ...days);
  const level = (v: number) => (v ? 0.12 + 0.88 * (v / max) : 0);
  const total = days.reduce((s, v) => s + v, 0);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[620px]">
        {/* Per hour */}
        <div className="grid grid-cols-[48px_repeat(24,minmax(0,1fr))_64px] items-end gap-[3px]" aria-label={t('stats.byHour')}>
          <span />
          {hours.map((v, h) => (
            <div key={h} className="flex h-10 items-end" title={`${String(h).padStart(2, '0')}:00 · ${num(v)}`}>
              <div className="w-full rounded-t-[3px] bg-koraal/50" style={{ height: `${Math.max(v ? 4 : 0, (v / hourMax) * 100)}%` }} />
            </div>
          ))}
          <span />
        </div>
        <div className="mt-1 grid grid-cols-[48px_repeat(24,minmax(0,1fr))_64px] gap-[3px]" role="grid">
          {data.map((row, d) => (
            <div key={d} className="contents" role="row">
              <span className="self-center pr-2 text-xs text-muted capitalize">{weekday(d, 'short')}</span>
              {row.map((v, h) => (
                <button
                  key={h}
                  type="button"
                  role="gridcell"
                  aria-label={`${weekday(d)} ${String(h).padStart(2, '0')}:00 · ${num(v)}`}
                  onPointerEnter={() => setHover({ d, h })}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover({ d, h })}
                  onBlur={() => setHover(null)}
                  className={cx('aspect-square min-h-5 rounded-[4px] transition outline-none focus-visible:ring-2 focus-visible:ring-ink', !v && 'bg-sunken', hover?.d === d && hover?.h === h && 'ring-2 ring-ink')}
                  style={v ? { background: `color-mix(in srgb, var(--koraal) ${Math.round(level(v) * 100)}%, var(--surface-sunken))` } : undefined}
                />
              ))}
              <div className="flex items-center gap-1.5 pl-2" title={`${weekday(d)} · ${num(days[d])}`}>
                <div className="h-2 rounded-full bg-koraal/50" style={{ width: `${Math.max(days[d] ? 4 : 0, (days[d] / dayMax) * 40)}px` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-[48px_repeat(24,minmax(0,1fr))_64px] gap-[3px] text-[10px] text-muted">
          <span />
          {hours.map((_, h) => (
            <span key={h} className="text-center tabular-nums">
              {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
            </span>
          ))}
          <span />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
          <p className="min-h-4 tabular-nums">
            {hover
              ? `${weekday(hover.d)} ${String(hover.h).padStart(2, '0')}:00–${String((hover.h + 1) % 24).padStart(2, '0')}:00 · ${num(data[hover.d][hover.h])} (${pct(total ? data[hover.d][hover.h] / total : 0)})`
              : ''}
          </p>
          <div className="flex items-center gap-1.5">
            {t('stats.fewer')}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <span key={f} className="size-3 rounded-[3px]" style={{ background: f ? `color-mix(in srgb, var(--koraal) ${Math.round((0.12 + 0.88 * f) * 100)}%, var(--surface-sunken))` : 'var(--surface-sunken)' }} />
            ))}
            {t('stats.more')}
          </div>
        </div>
      </div>
    </div>
  );
}

function ShareRows({ rows, onPick }: { rows: { key: string; label: ReactNode; value: number; sub?: ReactNode; delta?: number | null }[]; onPick?: (key: string) => void }) {
  const total = Math.max(1, rows.reduce((s, r) => s + r.value, 0));
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1">
      {rows.map((r) => {
        const inner = (
          <>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium">{r.label}</span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold">{num(r.value)}</span>
                <span className="ml-2 text-xs text-muted">{pct(r.value / total)}</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-sunken">
              <div className="h-full rounded-full bg-koraal" style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
            {(r.sub || r.delta != null) && (
              <div className="mt-1 flex items-center justify-between text-xs text-muted">
                <span>{r.sub}</span>
                {r.delta != null && Number.isFinite(r.delta) && <span className={cx('font-semibold', r.delta >= 0 ? 'text-online' : 'text-offline')}>{`${r.delta >= 0 ? '+' : '−'}${pct(Math.abs(r.delta))}`}</span>}
              </div>
            )}
          </>
        );
        return (
          <li key={r.key}>
            {onPick ? (
              <button type="button" onClick={() => onPick(r.key)} className="w-full rounded-xl px-3 py-2 text-left transition hover:bg-sunken/70">
                {inner}
              </button>
            ) : (
              <div className="px-3 py-2">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

type SortKey = 'name' | 'resellerName' | 'guests' | 'devices' | 'registrations' | 'change' | 'lastGuestAt';

function TenantTable({ rows, total, onPick }: { rows: Stats['byTenant']; total: number; onPick: (id: string) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'guests', desc: true });
  const [all, setAll] = useState(false);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const value = (r: Stats['byTenant'][number]) => (sort.key === 'change' ? (change(r.guests, r.previousGuests) ?? (r.guests ? Infinity : -Infinity)) : (r[sort.key] ?? ''));
    return rows
      .filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.resellerName?.toLowerCase().includes(needle))
      .sort((a, b) => {
        const va = value(a);
        const vb = value(b);
        const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), loc());
        return sort.desc ? -c : c;
      });
  }, [rows, q, sort]);
  const shown = all ? list : list.slice(0, 15);
  const head = (key: SortKey, label: string, right = false) => (
    <th className={cx('px-4 py-3 font-semibold whitespace-nowrap', right ? 'text-right' : 'text-left')} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
      <button type="button" className={cx('inline-flex items-center gap-1 hover:text-ink', sort.key === key && 'text-ink')} onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'name' && key !== 'resellerName' }))}>
        {label}
        {sort.key === key && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </th>
  );
  return (
    <>
      <div className="border-b border-line px-6 py-3">
        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('stats.search')} className="pl-9" aria-label={t('stats.search')} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              {head('name', t('stats.colCustomer'))}
              {head('resellerName', t('stats.colReseller'))}
              {head('guests', t('stats.colGuests'), true)}
              {head('devices', t('stats.colDevices'), true)}
              {head('registrations', t('stats.colRegistrations'), true)}
              {head('change', t('stats.colChange'), true)}
              {head('lastGuestAt', t('stats.colLast'), true)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((r) => {
              const c = change(r.guests, r.previousGuests);
              return (
                <tr key={r.id} className="cursor-pointer transition hover:bg-sunken/60" onClick={() => onPick(r.id)}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 font-medium">
                      {r.name}
                      {r.status === 'suspended' && <Badge tone="warning">{t('stats.suspended')}</Badge>}
                    </div>
                    <div className="mt-1 h-1 w-full max-w-[160px] overflow-hidden rounded-full bg-sunken">
                      <div className="h-full rounded-full bg-koraal" style={{ width: `${total ? (r.guests / total) * 100 : 0}%` }} />
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{r.resellerName ?? t('stats.direct')}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{num(r.guests)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{num(r.devices)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{num(r.registrations)}</td>
                  <td className={cx('px-4 py-2.5 text-right text-xs font-semibold tabular-nums', c === null ? 'text-muted' : c >= 0 ? 'text-online' : 'text-offline')}>
                    {c === null ? (r.guests ? t('stats.new') : '—') : `${c >= 0 ? '+' : '−'}${pct(Math.abs(c))}`}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs whitespace-nowrap text-muted">{r.lastGuestAt ? timeAgo(r.lastGuestAt) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.length > 15 && (
        <div className="border-t border-line px-6 py-3">
          <Button variant="ghost" size="sm" onClick={() => setAll(!all)}>
            {all ? t('stats.showLess') : t('stats.showAll', { count: list.length })}
          </Button>
        </div>
      )}
    </>
  );
}

export function StatisticsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const preset = (PRESETS.includes(params.get('period') as Preset) ? params.get('period') : '30d') as Preset;
  const range = presetRange(preset) ?? { from: params.get('from') ?? presetRange('30d')!.from, to: params.get('to') ?? iso(new Date()) };
  const reseller = params.get('reseller') ?? '';
  const tenant = params.get('tenant') ?? '';
  const granularity = (['day', 'week', 'month'].includes(params.get('by') ?? '') ? params.get('by') : '') as Granularity | '';
  const [metric, setMetric] = useState<'guests' | 'devices' | 'tenants'>('guests');

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const query = new URLSearchParams({ from: range.from, to: range.to });
  if (reseller) query.set('reseller', reseller);
  if (tenant) query.set('tenant', tenant);
  if (granularity) query.set('granularity', granularity);
  const qs = query.toString();
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['platform-stats', qs],
    queryFn: () => api.get<{ stats: Stats; options: Options }>(`/platform/stats?${qs}`),
    placeholderData: keepPreviousData,
  });
  const s = data?.stats;
  const opts = data?.options;
  const tenantsForReseller = (opts?.tenants ?? []).filter((x) => !reseller || (reseller === 'direct' ? !x.resellerId : x.resellerId === reseller));
  const exportUrl = (format: 'csv' | 'pdf') => `/api/platform/stats/export?${qs}&format=${format}&lang=${currentLocale()}`;
  const filtered = Boolean(reseller || tenant || granularity || preset !== '30d');

  const methods = s
    ? Object.entries(s.byMethod)
        .filter(([, v]) => v)
        .sort((a, b) => b[1] - a[1])
    : [];

  return (
    <>
      <PageHeader
        eyebrow={t('stats.eyebrow')}
        title={t('stats.title')}
        description={t('stats.description')}
        actions={
          <>
            <Button variant="secondary" icon={<Download className="size-4" />} title={t('stats.exportHint')} onClick={() => window.location.assign(exportUrl('csv'))}>
              {t('stats.exportCsv')}
            </Button>
            <Button variant="accent" icon={<FileText className="size-4" />} title={t('stats.exportHint')} onClick={() => window.location.assign(exportUrl('pdf'))}>
              {t('stats.exportPdf')}
            </Button>
          </>
        }
      />

      {/* Filters: one row above the charts */}
      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 basis-full xl:basis-auto">
            <p className="mb-1.5 text-xs font-medium text-muted">{t('stats.period')}</p>
            <div className="overflow-x-auto">
              <Segmented
                value={preset}
                label={t('stats.period')}
                options={PRESETS.map((p) => ({ value: p, label: t(`stats.presets.${p}`) }))}
                onChange={(p) => update(p === 'custom' ? { period: 'custom', from: range.from, to: range.to } : { period: p === '30d' ? null : p, from: null, to: null })}
              />
            </div>
          </div>
          {preset === 'custom' && (
            <>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted">{t('stats.from')}</span>
                <Input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && update({ from: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted">{t('stats.to')}</span>
                <Input type="date" value={range.to} min={range.from} max={iso(new Date())} onChange={(e) => e.target.value && update({ to: e.target.value })} />
              </label>
            </>
          )}
          <label className="block min-w-[180px] flex-1 sm:flex-none">
            <span className="mb-1.5 block text-xs font-medium text-muted">{t('stats.reseller')}</span>
            <Select value={reseller} onChange={(e) => update({ reseller: e.target.value || null, tenant: null })}>
              <option value="">{t('stats.allResellers')}</option>
              <option value="direct">{t('stats.direct')}</option>
              {opts?.resellers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block min-w-[180px] flex-1 sm:flex-none">
            <span className="mb-1.5 block text-xs font-medium text-muted">{t('stats.customer')}</span>
            <Select value={tenant} onChange={(e) => update({ tenant: e.target.value || null })}>
              <option value="">{t('stats.allCustomers')}</option>
              {tenantsForReseller.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </label>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">{t('stats.granularity')}</p>
            <Segmented
              value={granularity || 'auto'}
              label={t('stats.granularity')}
              options={(['auto', 'day', 'week', 'month'] as const).map((g) => ({ value: g, label: t(`stats.${g}`) }))}
              onChange={(g) => update({ by: g === 'auto' ? null : g })}
            />
          </div>
          {filtered && (
            <Button variant="ghost" size="sm" icon={<X className="size-4" />} onClick={() => setParams({}, { replace: true })} className="mb-1">
              {t('stats.reset')}
            </Button>
          )}
          {isFetching && !isLoading && <Spinner className="mb-2" />}
        </div>
      </Card>

      {error ? (
        <Card className="p-6 text-sm text-offline">{(error as Error).message}</Card>
      ) : isLoading || !s ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <Kpi icon={<UserCheck className="size-5" />} label={t('stats.guests')} value={num(s.totals.guests)} delta={change(s.totals.guests, s.previous.guests)} />
            <Kpi icon={<Smartphone className="size-5" />} label={t('stats.devices')} value={num(s.totals.uniqueDevices)} delta={change(s.totals.uniqueDevices, s.previous.uniqueDevices)} />
            <Kpi
              icon={<Building2 className="size-5" />}
              label={t('stats.activeTenants')}
              value={num(s.totals.activeTenants)}
              sub={t('stats.activeTenantsOf', { total: num(s.totals.tenants) })}
              delta={change(s.totals.activeTenants, s.previous.activeTenants)}
            />
            <Kpi icon={<Radio className="size-5" />} label={t('stats.onlineNow')} value={num(s.totals.onlineNow)} sub={t('stats.onlineNowHint')} live />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <MiniStat label={t('stats.registrations')} value={num(s.totals.registrations)} />
            <MiniStat label={t('stats.newDevices')} value={num(s.totals.newDevices)} sub={`${t('stats.returningDevices')}: ${num(s.totals.returningDevices)}`} />
            <MiniStat label={t('stats.newTenants')} value={num(s.totals.newTenants)} />
            <MiniStat label={t('stats.activeAdmins')} value={num(s.totals.activeAdmins)} />
            <MiniStat label={t('stats.vouchers')} value={num(s.totals.vouchersUsed)} sub={`${t('stats.paidSessions')}: ${num(s.totals.paidSessions)}`} />
            <MiniStat
              label={t('stats.revenue')}
              value={
                s.totals.guestRevenue.length
                  ? s.totals.guestRevenue.map((r) => new Intl.NumberFormat(loc(), { style: 'currency', currency: r.currency }).format(r.cents / 100)).join(' + ')
                  : new Intl.NumberFormat(loc(), { style: 'currency', currency: 'EUR' }).format(0)
              }
              sub={`${t('stats.optIns')}: ${num(s.totals.marketingOptIns)}`}
            />
          </div>

          {!s.totals.guests ? (
            <Card>
              <EmptyState icon={<BarChart3 className="size-6" />} title={t('stats.noGuests')} description={t('stats.noGuestsText')} />
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader
                  title={t('stats.trend')}
                  description={[
                    t('stats.trendHint', { from: dayLabel(s.from, { day: 'numeric', month: 'short', year: 'numeric' }), to: dayLabel(s.to, { day: 'numeric', month: 'short', year: 'numeric' }), unit: t(`stats.units.${s.granularity}`) }),
                    s.busiestDay ? t('stats.busiest', { unit: t(`stats.units.${s.granularity}`), label: bucketLabel(s.busiestDay.bucket, s.granularity, true), count: num(s.busiestDay.count) }) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  action={
                    <div className="hidden sm:block">
                      <Segmented
                        value={metric}
                        onChange={setMetric}
                        options={[
                          { value: 'guests', label: t('stats.colGuests') },
                          { value: 'devices', label: t('stats.colDevices') },
                          { value: 'tenants', label: t('stats.activeTenants') },
                        ]}
                      />
                    </div>
                  }
                />
                <div className="px-4 pt-4 pb-2 sm:px-6">
                  {metric === 'guests' && (
                    <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted">
                      <span className="flex items-center gap-1.5">
                        <span className="h-0.5 w-4 rounded bg-koraal" />
                        {t('stats.thisPeriod')}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-4 border-t-2 border-dashed border-muted/70" />
                        {t('stats.previousPeriod')}
                      </span>
                    </div>
                  )}
                  <TrendChart series={s.series} previous={s.previousSeries} granularity={s.granularity} metric={metric} />
                </div>
              </Card>

              <Card>
                <CardHeader
                  title={t('stats.heatmap')}
                  description={[
                    t('stats.heatmapHint'),
                    s.peak ? t('stats.peak', { weekday: weekday(s.peak.weekday), from: String(s.peak.hour).padStart(2, '0'), to: String((s.peak.hour + 1) % 24).padStart(2, '0'), count: num(s.peak.count) }) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
                <div className="p-6">
                  <Heatmap data={s.heatmap} />
                </div>
              </Card>

              <div className={cx('grid gap-6', !tenant && !reseller && 'lg:grid-cols-2')}>
                {!tenant && !reseller && (
                  <Card>
                    <CardHeader title={t('stats.byReseller')} description={t('stats.byResellerHint')} />
                    <div className="p-3">
                      <ShareRows
                        rows={s.byReseller.map((r) => ({
                          key: r.id ?? 'direct',
                          label: r.id ? r.name : t('stats.direct'),
                          value: r.guests,
                          sub: t('stats.customersCount', { active: num(r.activeTenants), total: num(r.tenants) }),
                          delta: change(r.guests, r.previousGuests),
                        }))}
                        onPick={(key) => update({ reseller: key, tenant: null })}
                      />
                    </div>
                  </Card>
                )}
                <Card>
                  <CardHeader title={t('stats.byMethod')} />
                  <div className="p-3">
                    <ShareRows rows={methods.map(([k, v]) => ({ key: k, label: t(`reports.methods.${k as 'other'}`), value: v }))} />
                  </div>
                </Card>
              </div>

              {!tenant && (
                <Card>
                  <CardHeader title={t('stats.byTenant')} description={t('stats.byTenantHint')} />
                  <TenantTable rows={s.byTenant} total={s.totals.guests} onPick={(id) => update({ tenant: id })} />
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
