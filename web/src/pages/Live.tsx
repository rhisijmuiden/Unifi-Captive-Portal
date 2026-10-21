import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, CheckCircle2, Radio, Router, UserCheck, Users, Wifi, WifiOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Spinner, StatusDot, cx } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';

export type Live = {
  now: string;
  currentHour: number;
  online: number;
  onlineBySite: { name: string; count: number }[];
  onlineByAccessPoint: { name: string; count: number }[];
  today: { connections: number; devices: number; registrations: number; lastHour: number };
  lastWeek: { connections: number };
  byHour: number[];
  byHourLastWeek: number[];
  byMethod: { method: string; count: number }[];
  recent: { id: string; method: string | null; name: string | null; email: string | null; phone: string | null; clientMac: string; siteName: string | null; authorizedAt: string; online: boolean }[];
  consoles: { id: string; name: string; status: string; offlineSince: string | null; lastSyncAt: string | null; lastError: string | null; accessPoints: number; accessPointsOffline: number }[];
  offlineDevices: { mac: string; name: string | null; model: string | null; siteName: string; offlineSince: string }[];
};

const POLL_MS = 10_000;

function Tile({ icon, label, value, sub, live }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; live?: boolean }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="grid size-10 place-items-center rounded-xl bg-koraal/12 text-accent">{icon}</span>
        {live && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-online">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-online opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-online" />
            </span>
            LIVE
          </span>
        )}
      </div>
      <p className="display mt-4 text-3xl tabular-nums">{value}</p>
      <p className="text-sm text-muted">{label}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </Card>
  );
}

/** Today's connections per hour as bars, with the same weekday last week as a thin marker for comparison. */
function HourChart({ today, lastWeek, currentHour }: { today: number[]; lastWeek: number[]; currentHour: number }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...today, ...lastWeek);
  const ticks = [0, 6, 12, 18, 23];
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm bg-koraal" /> {t('live.todayLegend')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 rounded-full bg-ink/45" /> {t('live.lastWeekLegend')}
        </span>
      </div>
      <div className="relative">
        <div className="flex h-44 items-end gap-[2px]" role="img" aria-label={t('live.byHour')}>
          {today.map((v, h) => (
            <div key={h} className="relative flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setHover(h)} onMouseLeave={() => setHover(null)}>
              <div
                className={cx('w-full rounded-t-[4px] transition-colors', h > currentHour ? 'bg-transparent' : hover === h ? 'bg-koraal' : 'bg-koraal/80')}
                style={{ height: `${(v / max) * 100}%`, minHeight: v ? 3 : 0 }}
              />
              {lastWeek[h] > 0 && <div className="absolute right-0.5 left-0.5 h-0.5 rounded-full bg-ink/45" style={{ bottom: `calc(${(lastWeek[h] / max) * 100}% - 1px)` }} />}
              {hover === h && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 rounded-lg border border-line bg-raised px-3 py-2 text-xs whitespace-nowrap shadow-card">
                  <p className="font-semibold">
                    {String(h).padStart(2, '0')}:00–{String(h + 1).padStart(2, '0')}:00
                  </p>
                  <p>
                    {t('live.todayLegend')}: <b className="tabular-nums">{v}</b>
                  </p>
                  <p className="text-muted">
                    {t('live.lastWeekLegend')}: <span className="tabular-nums">{lastWeek[h]}</span>
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-1 h-px bg-line" />
        <div className="relative mt-1 h-4 text-[11px] text-muted">
          {ticks.map((h) => (
            <span key={h} className="absolute -translate-x-1/2" style={{ left: `${((h + 0.5) / 24) * 100}%` }}>
              {String(h).padStart(2, '0')}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Horizontal bars for a breakdown (methods, locations); one colour, values as text. */
export function Breakdown({ rows, empty }: { rows: { label: string; count: number }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex justify-between text-sm">
            <span>{r.label}</span>
            <span className="font-semibold tabular-nums">{r.count}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full bg-koraal" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function LivePage() {
  const { t } = useTranslation();
  const { data, isLoading, dataUpdatedAt } = useQuery({ queryKey: ['live'], queryFn: () => api.get<Live>('/live'), refetchInterval: POLL_MS, refetchIntervalInBackground: false });
  if (isLoading || !data) return <Spinner />;
  const methodLabel = (m: string) => t(`live.methods.${m as 'free'}`, { defaultValue: m });
  const diff = data.today.connections - data.lastWeek.connections;
  const consolesDown = data.consoles.filter((c) => c.status === 'error');

  return (
    <>
      <PageHeader
        eyebrow={t('nav.insights')}
        title={t('live.title')}
        description={t('live.description')}
        actions={<span className="text-xs text-muted">{t('live.updated', { time: new Date(dataUpdatedAt).toLocaleTimeString() })}</span>}
      />

      {(consolesDown.length > 0 || data.offlineDevices.length > 0) && (
        <Link to="/consoles" className="mb-6 flex gap-3 rounded-2xl border border-offline/30 bg-offline/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-offline" />
          <span>
            <span className="block font-semibold">{t('live.problems')}</span>
            <span className="text-muted">
              {[
                ...consolesDown.map((c) => t('live.consoleDown', { name: c.name, when: c.offlineSince ? timeAgo(c.offlineSince) : '' })),
                ...data.offlineDevices.map((d) => t('live.deviceDown', { name: d.name ?? d.mac, site: d.siteName, when: timeAgo(d.offlineSince) })),
              ].join(' · ')}
            </span>
          </span>
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile icon={<Wifi className="size-5" />} label={t('live.online')} value={data.online} live sub={data.onlineBySite.length > 1 ? data.onlineBySite.map((s) => `${s.name} ${s.count}`).join(' · ') : undefined} />
        <Tile
          icon={<UserCheck className="size-5" />}
          label={t('live.connectionsToday')}
          value={data.today.connections}
          sub={t('live.vsLastWeek', { value: `${diff >= 0 ? '+' : ''}${diff}` })}
        />
        <Tile icon={<Users className="size-5" />} label={t('live.devicesToday')} value={data.today.devices} sub={t('live.registrations', { count: data.today.registrations })} />
        <Tile icon={<Activity className="size-5" />} label={t('live.lastHour')} value={data.today.lastHour} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t('live.byHour')} description={t('live.byHourHint')} />
          <div className="p-6">
            <HourChart today={data.byHour} lastWeek={data.byHourLastWeek} currentHour={data.currentHour} />
          </div>
        </Card>
        <Card>
          <CardHeader title={t('live.byMethod')} />
          <div className="p-6">
            <Breakdown rows={data.byMethod.map((m) => ({ label: methodLabel(m.method), count: m.count }))} empty={t('live.nothingYet')} />
          </div>
          <div className="border-t border-line p-6">
            <p className="mb-4 font-semibold">{t('live.byAccessPoint')}</p>
            <Breakdown rows={data.onlineByAccessPoint.map((a) => ({ label: a.name, count: a.count }))} empty={t('live.nobodyOnline')} />
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title={t('live.recent')} />
          {!data.recent.length ? (
            <EmptyState icon={<Radio className="size-6" />} title={t('live.noGuests')} description={t('live.noGuestsHint')} />
          ) : (
            <ul className="divide-y divide-line">
              {data.recent.map((g) => (
                <li key={g.id} className="flex items-center gap-3 px-6 py-3">
                  <StatusDot tone={g.online ? 'online' : 'warning'} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{g.name || g.email || g.phone || g.clientMac}</p>
                    <p className="truncate text-xs text-muted">
                      {methodLabel(g.method ?? 'other')}
                      {g.siteName ? ` · ${g.siteName}` : ''}
                    </p>
                  </div>
                  <span className="text-xs whitespace-nowrap text-muted">{timeAgo(g.authorizedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={t('live.network')} />
          {!data.consoles.length ? (
            <EmptyState icon={<Router className="size-6" />} title={t('live.noConsoles')} description={t('live.noConsolesHint')} />
          ) : (
            <ul className="divide-y divide-line">
              {data.consoles.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-6 py-3.5">
                  {c.status === 'error' ? <WifiOff className="size-5 shrink-0 text-offline" /> : <CheckCircle2 className="size-5 shrink-0 text-online" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="truncate text-xs text-muted">
                      {t('live.accessPoints', { count: c.accessPoints })}
                      {c.accessPointsOffline > 0 && ` · ${t('live.accessPointsOffline', { count: c.accessPointsOffline })}`}
                    </p>
                  </div>
                  {c.status === 'error' ? (
                    <Badge tone="offline">{t('live.offlineSince', { when: c.offlineSince ? timeAgo(c.offlineSince) : '' })}</Badge>
                  ) : (
                    <Badge tone={c.accessPointsOffline ? 'warning' : 'online'}>{c.accessPointsOffline ? t('live.partly') : t('live.ok')}</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
