import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Copy, Globe, Lock, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { guideUrl } from '../lib/docs';
import { formatDate, timeAgo } from '../lib/format';
import { ChooseTenant, TenantPicker, useTenantScope } from '../lib/tenant';

export type HostnameStatus = 'pending' | 'dns_ok' | 'active' | 'error';
type Hostname = { id: string; hostname: string; status: HostnameStatus; lastError: string | null; lastCheckedAt: string | null; activatedAt: string | null; createdAt: string };

/** Turns a stored "code:detail" check result into a sentence in the current language. */
export function useCheckMessage() {
  const { t } = useTranslation();
  return (raw: string | null) => {
    if (!raw) return null;
    const [code, ...rest] = raw.split(':');
    const detail = rest.join(':');
    return t(`hostnames.errors.${code}`, { detail, defaultValue: raw });
  };
}

export function StatusBadge({ status }: { status: HostnameStatus }) {
  const { t } = useTranslation();
  const tone = { pending: 'neutral', dns_ok: 'info', active: 'online', error: 'offline' } as const;
  return <Badge tone={tone[status]}>{status === 'active' && <Lock className="size-3" />} {t(`hostnames.status.${status}`)}</Badge>;
}

export function DnsRecords({ ipv4, ipv6, host }: { ipv4: string | null; ipv6: string | null; host: string }) {
  const { t } = useTranslation();
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success(t('common.copied')));
  const rows = [ipv4 && { type: 'A', value: ipv4 }, ipv6 && { type: 'AAAA', value: ipv6 }].filter(Boolean) as { type: string; value: string }[];
  if (!rows.length) return <p className="text-sm text-warning">{t('hostnames.ipMissing')}</p>;
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead className="bg-surface text-left text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">{t('hostnames.recordType')}</th>
            <th className="px-3 py-2 font-medium">{t('hostnames.recordName')}</th>
            <th className="px-3 py-2 font-medium">{t('hostnames.recordValue')}</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-line font-mono text-xs">
          {rows.map((r) => (
            <tr key={r.type}>
              <td className="px-3 py-2 font-semibold">{r.type}</td>
              <td className="px-3 py-2 break-all">{host}</td>
              <td className="px-3 py-2 break-all">{r.value}</td>
              <td className="px-1 text-right">
                <Button variant="ghost" size="sm" onClick={() => copy(r.value)} aria-label={t('common.copy')}>
                  <Copy className="size-3.5" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HostnamesPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const scope = useTenantScope();
  const checkMessage = useCheckMessage();
  const [hostname, setHostname] = useState('');
  const [deleting, setDeleting] = useState<Hostname | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['hostnames', scope.tenantId],
    queryFn: () => api.get<{ hostnames: Hostname[]; target: { ipv4: string | null; ipv6: string | null } }>(`/hostnames${scope.qs}`),
    enabled: Boolean(scope.tenantId),
    // Keep the status fresh while a certificate is on its way
    refetchInterval: (q) => (q.state.data?.hostnames.some((h) => h.status !== 'active') ? 15_000 : false),
  });
  const add = useMutation({
    mutationFn: () => api.post('/hostnames', { ...scope.body, hostname }),
    onSuccess: () => {
      setHostname('');
      qc.invalidateQueries({ queryKey: ['hostnames'] });
      toast.success(t('hostnames.added'));
      // The first DNS check runs in the background; show its result shortly after
      setTimeout(() => qc.invalidateQueries({ queryKey: ['hostnames'] }), 2500);
    },
  });
  const check = useMutation({
    mutationFn: (id: string) => api.post<{ hostname: Hostname }>(`/hostnames/${id}/check${scope.qs}`),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['hostnames'] });
      if (d.hostname.status === 'active') toast.success(t('hostnames.nowActive', { host: d.hostname.hostname }));
      else toast.info(checkMessage(d.hostname.lastError) ?? t(`hostnames.status.${d.hostname.status}`));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/hostnames/${id}${scope.qs}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hostnames'] });
      toast.success(t('hostnames.deleted'));
      setDeleting(null);
    },
  });

  const list = data?.hostnames ?? [];
  const example = list[0]?.hostname ?? hostname ?? t('hostnames.placeholder');

  return (
    <>
      <PageHeader eyebrow={t('nav.portals')} title={t('hostnames.title')} description={t('hostnames.description')} actions={<TenantPicker scope={scope} />} />
      {!scope.tenantId ? (
        scope.loading ? <Spinner /> : <Card><ChooseTenant /></Card>
      ) : isLoading ? (
        <Spinner />
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            {scope.canManage && (
              <Card className="p-5">
                <form
                  className="flex flex-col gap-3 sm:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    add.mutate();
                  }}
                >
                  <div className="relative flex-1">
                    <Globe className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                    <Input className="pl-9" placeholder={t('hostnames.placeholder')} value={hostname} onChange={(e) => setHostname(e.target.value.trim())} aria-label={t('hostnames.hostname')} />
                  </div>
                  <Button variant="accent" type="submit" loading={add.isPending} disabled={hostname.length < 4} icon={<Plus className="size-4" />}>
                    {t('hostnames.add')}
                  </Button>
                </form>
                {add.error && <p className="mt-2 text-sm text-offline">{add.error.message}</p>}
              </Card>
            )}

            <Card>
              {!list.length ? (
                <EmptyState icon={<Globe className="size-6" />} title={t('hostnames.empty')} description={t('hostnames.emptyHint')} />
              ) : (
                <ul className="divide-y divide-line">
                  {list.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {h.status === 'active' ? (
                            <a href={`https://${h.hostname}/portal/preview`} className="font-semibold break-all hover:underline" target="_blank" rel="noreferrer">
                              {h.hostname}
                            </a>
                          ) : (
                            <span className="font-semibold break-all">{h.hostname}</span>
                          )}
                          <StatusBadge status={h.status} />
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {h.status === 'active' && h.activatedAt
                            ? t('hostnames.activeSince', { date: formatDate(h.activatedAt) })
                            : h.lastCheckedAt
                              ? t('hostnames.lastChecked', { time: timeAgo(h.lastCheckedAt) })
                              : t('hostnames.notChecked')}
                        </p>
                        {h.status !== 'active' && h.lastError && <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">{checkMessage(h.lastError)}</p>}
                      </div>
                      {scope.canManage && (
                        <div className="flex gap-1">
                          <Button variant="secondary" size="sm" icon={<RefreshCw className="size-3.5" />} loading={check.isPending && check.variables === h.id} onClick={() => check.mutate(h.id)}>
                            {t('hostnames.checkNow')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeleting(h)} aria-label={t('common.delete')}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card className="h-fit">
            <CardHeader title={t('hostnames.howTitle')} />
            <div className="space-y-4 p-6 text-sm">
              <p className="text-muted">{t('hostnames.howIntro')}</p>
              <DnsRecords ipv4={data?.target.ipv4 ?? null} ipv6={data?.target.ipv6 ?? null} host={example} />
              <ol className="space-y-2">
                {(['how1', 'how2', 'how3'] as const).map((k, i) => (
                  <li key={k} className="flex gap-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-koraal/15 text-xs font-bold text-accent">{i + 1}</span>
                    <span>{t(`hostnames.${k}`)}</span>
                  </li>
                ))}
              </ol>
              <a href={guideUrl('hostnames', i18n.resolvedLanguage)} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-accent hover:underline">
                <BookOpen className="size-4" /> {t('hostnames.guideLink')}
              </a>
            </div>
          </Card>
        </div>
      )}

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={t('hostnames.deleteTitle')}
        description={t('hostnames.deleteText', { host: deleting?.hostname })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{t('hostnames.deleteTip')}</p>
      </Modal>
    </>
  );
}
