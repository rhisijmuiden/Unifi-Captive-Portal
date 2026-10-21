import type { LoginMethod } from '@shared/portalDesign';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Download, Trash2, UserCheck, Wifi } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '../components/controls';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
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
  method: LoginMethod | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  marketingOptIn: boolean;
  voucherCode: string | null;
  packageName: string | null;
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
  const qc = useQueryClient();
  const [confirmDialog, ask] = useConfirm();
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/guests/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guests'] });
      toast.success(t('guests.removed'));
    },
  });
  const exportCsv = () => {
    const rows = [
      ['arrived', 'status', 'method', 'name', 'email', 'phone', 'marketing_opt_in', 'voucher', 'package', 'device', 'site', 'access_until'],
      ...(data?.guests ?? []).map((g) => [g.createdAt, g.status, g.method ?? '', g.name ?? '', g.email ?? '', g.phone ?? '', g.marketingOptIn ? 'yes' : 'no', g.voucherCode ?? '', g.packageName ?? '', g.clientMac, g.siteName ?? '', g.accessUntil ?? '']),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: url, download: 'guests.csv' }).click();
    URL.revokeObjectURL(url);
  };
  const now = Date.now();
  const status = (g: Guest) => {
    if (g.status === 'authorized' && g.accessUntil && new Date(g.accessUntil).getTime() > now) return <Badge tone="online">{t('guests.online')}</Badge>;
    if (g.status === 'authorized') return <Badge>{t('guests.expired')}</Badge>;
    if (g.status === 'failed') return <Badge tone="offline">{t('guests.failed')}</Badge>;
    return <Badge tone="warning">{t('guests.pending')}</Badge>;
  };

  return (
    <>
      <PageHeader
        eyebrow={t('nav.insights')}
        title={t('guests.title')}
        description={t('guests.description')}
        actions={
          <Button variant="secondary" icon={<Download className="size-4" />} disabled={!data?.guests.length} onClick={exportCsv}>
            {t('guests.export')}
          </Button>
        }
      />
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
                      <th className="px-6 py-3 font-medium">{t('guests.colGuest')}</th>
                      <th className="px-6 py-3 font-medium">{t('guests.colStatus')}</th>
                      <th className="hidden px-6 py-3 font-medium sm:table-cell">{t('guests.colMethod')}</th>
                      <th className="hidden px-6 py-3 font-medium md:table-cell">{t('guests.colSite')}</th>
                      <th className="hidden px-6 py-3 font-medium lg:table-cell">{t('guests.colArrived')}</th>
                      <th className="hidden px-6 py-3 font-medium lg:table-cell">{t('guests.colUntil')}</th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.guests.map((g) => (
                      <tr key={g.id} className="transition hover:bg-sunken/50">
                        <td className="px-6 py-3">
                          {(g.name || g.email) && <p className="font-medium">{g.name ?? g.email}</p>}
                          {g.name && g.email && <p className="text-xs text-muted">{g.email}</p>}
                          {g.phone && <p className="text-xs text-muted">{g.phone}</p>}
                          <p className="font-mono text-xs text-muted">{g.clientMac}{g.ssid ? ` · ${g.ssid}` : ''}</p>
                        </td>
                        <td className="px-6 py-3">
                          {status(g)}
                          {g.status === 'failed' && g.error && <p className="mt-1 max-w-xs truncate text-xs text-muted" title={g.error}>{g.error}</p>}
                        </td>
                        <td className="hidden px-6 py-3 sm:table-cell">
                          {g.method ? <Badge tone="info">{t(`guests.methods.${g.method}`)}</Badge> : '—'}
                          {g.voucherCode && <p className="mt-1 font-mono text-xs text-muted">{g.voucherCode}</p>}
                          {g.packageName && <p className="mt-1 text-xs text-muted">{g.packageName}</p>}
                          {g.marketingOptIn && <p className="mt-1 text-xs text-online">{t('guests.optIn')}</p>}
                        </td>
                        <td className="hidden px-6 py-3 text-muted md:table-cell">{g.siteName ?? '—'}</td>
                        <td className="hidden px-6 py-3 text-muted lg:table-cell">{formatDate(g.createdAt)}</td>
                        <td className="hidden px-6 py-3 text-muted lg:table-cell">{formatDate(g.accessUntil)}</td>
                        <td className="px-6 py-3 text-right">
                          {scope.canManage && (
                            <Button variant="ghost" size="sm" aria-label={t('guests.remove')} title={t('guests.remove')} onClick={async () => (await ask(t('guests.confirmRemove'))) && remove.mutate(g.id)}>
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
      {confirmDialog}
    </>
  );
}
