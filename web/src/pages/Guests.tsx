import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, UserCheck, Wifi } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { useTenantScope } from '../lib/tenant';

type Guest = {
  id: string;
  clientMac: string;
  apMac: string | null;
  ssid: string | null;
  status: 'pending' | 'authorized' | 'failed';
  error: string | null;
  locale: string | null;
  siteName: string | null;
  createdAt: string;
  authorizedAt: string | null;
  accessUntil: string | null;
};

function Tile({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <Card className="p-5">
      <span className="grid size-10 place-items-center rounded-xl bg-koraal/12 text-accent">{icon}</span>
      <p className="display mt-4 text-3xl">{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </Card>
  );
}

export function GuestsPage() {
  const { t } = useTranslation();
  const scope = useTenantScope();
  const { data, isLoading } = useQuery({
    queryKey: ['guests', scope.tenantId],
    queryFn: () => api.get<{ guests: Guest[]; stats: { today: number; active: number } }>('/guests'),
    enabled: Boolean(scope.tenantId),
    refetchInterval: 30_000,
  });
  const now = Date.now();
  const status = (g: Guest) => {
    if (g.status === 'authorized' && g.accessUntil && new Date(g.accessUntil).getTime() > now) return <Badge tone="online">{t('guests.online')}</Badge>;
    if (g.status === 'authorized') return <Badge>{t('guests.expired')}</Badge>;
    if (g.status === 'failed') return <Badge tone="offline">{t('guests.failed')}</Badge>;
    return <Badge tone="warning">{t('guests.pending')}</Badge>;
  };

  return (
    <>
      <PageHeader eyebrow={t('nav.portals')} title={t('guests.title')} description={t('guests.description')} />
      {isLoading ? (
        <Spinner />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Tile icon={<Wifi className="size-5" />} label={t('guests.activeNow')} value={data?.stats.active ?? 0} />
            <Tile icon={<CalendarCheck className="size-5" />} label={t('guests.today')} value={data?.stats.today ?? 0} />
            <Tile icon={<UserCheck className="size-5" />} label={t('guests.recent')} value={data?.guests.length ?? 0} />
          </div>
          <Card className="mt-6">
            {!data?.guests.length ? (
              <EmptyState icon={<UserCheck className="size-6" />} title={t('guests.empty')} description={t('guests.emptyHint')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="px-6 py-3 font-medium">{t('guests.colDevice')}</th>
                      <th className="px-6 py-3 font-medium">{t('guests.colStatus')}</th>
                      <th className="hidden px-6 py-3 font-medium md:table-cell">{t('guests.colSite')}</th>
                      <th className="hidden px-6 py-3 font-medium lg:table-cell">{t('guests.colArrived')}</th>
                      <th className="hidden px-6 py-3 font-medium lg:table-cell">{t('guests.colUntil')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.guests.map((g) => (
                      <tr key={g.id} className="transition hover:bg-sunken/50">
                        <td className="px-6 py-3">
                          <p className="font-mono text-xs">{g.clientMac}</p>
                          {g.ssid && <p className="text-xs text-muted">{g.ssid}</p>}
                        </td>
                        <td className="px-6 py-3">
                          {status(g)}
                          {g.status === 'failed' && g.error && <p className="mt-1 max-w-xs truncate text-xs text-muted" title={g.error}>{g.error}</p>}
                        </td>
                        <td className="hidden px-6 py-3 text-muted md:table-cell">{g.siteName ?? '—'}</td>
                        <td className="hidden px-6 py-3 text-muted lg:table-cell">{formatDate(g.createdAt)}</td>
                        <td className="hidden px-6 py-3 text-muted lg:table-cell">{formatDate(g.accessUntil)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
