import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, Input, PageHeader, Spinner, Switch } from '../components/ui';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { useTenantScope } from '../lib/tenant';

type Settings = { hostnameLive: boolean; monthlyReport: boolean; notifyAdmins: boolean; recipients: string[] };
type LogEntry = { id: string; kind: string; ref: string; recipients: string[]; status: 'sent' | 'failed' | 'skipped' | 'sending'; error: string | null; createdAt: string };

const tones = { sent: 'online', failed: 'offline', skipped: 'neutral', sending: 'warning' } as const;

export function NotificationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const scope = useTenantScope();
  const { data, isLoading } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<{ settings: Settings; log: LogEntry[]; recipients: string[] }>('/notification-settings') });
  const [form, setForm] = useState<Settings | null>(null);
  const [draft, setDraft] = useState('');
  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);
  const save = useMutation({
    mutationFn: (next: Settings) => api.put('/notification-settings', next),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      toast.success(t('common.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (isLoading || !form || !data) return <Spinner />;
  const update = (patch: Partial<Settings>) => {
    const next = { ...form, ...patch };
    setForm(next);
    if (scope.canManage) save.mutate(next);
  };
  const add = () => {
    const email = draft.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || form.recipients.includes(email)) return;
    update({ recipients: [...form.recipients, email] });
    setDraft('');
  };

  return (
    <>
      <PageHeader eyebrow={t('nav.insights')} title={t('notifications.title')} description={t('notifications.description')} />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader title={t('notifications.what')} />
            <div className="space-y-5 p-6">
              <Switch checked={form.hostnameLive} onChange={(v) => update({ hostnameLive: v })} label={t('notifications.hostnameLive')} description={t('notifications.hostnameLiveHint')} />
              <Switch checked={form.monthlyReport} onChange={(v) => update({ monthlyReport: v })} label={t('notifications.monthlyReport')} description={t('notifications.monthlyReportHint')} />
              <p className="text-xs text-muted">{t('notifications.templatesLink')}</p>
            </div>
          </Card>
          <Card>
            <CardHeader title={t('notifications.who')} />
            <div className="space-y-5 p-6">
              <Switch checked={form.notifyAdmins} onChange={(v) => update({ notifyAdmins: v })} label={t('notifications.notifyAdmins')} description={t('notifications.notifyAdminsHint')} />
              <div>
                <p className="text-sm font-medium">{t('notifications.recipients')}</p>
                <p className="mb-2 text-xs text-muted">{t('notifications.recipientsHint')}</p>
                <div className="flex gap-2">
                  <Input type="email" value={draft} placeholder="manager@company.com" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} disabled={!scope.canManage} />
                  <Button variant="secondary" icon={<Plus className="size-4" />} onClick={add} disabled={!scope.canManage}>
                    {t('notifications.addRecipient')}
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {form.recipients.map((r) => (
                    <span key={r} className="inline-flex items-center gap-1.5 rounded-full bg-sunken py-1 pr-1.5 pl-3 text-sm">
                      {r}
                      {scope.canManage && (
                        <button type="button" aria-label={t('common.delete')} className="rounded-full p-0.5 text-muted hover:bg-line hover:text-ink" onClick={() => update({ recipients: form.recipients.filter((x) => x !== r) })}>
                          <X className="size-3.5" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-xl bg-sunken p-4">
                <p className="text-xs font-semibold tracking-wider text-muted uppercase">{t('notifications.current')}</p>
                <p className="mt-1 text-sm">{data.recipients.length ? data.recipients.join(', ') : t('notifications.none')}</p>
              </div>
            </div>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader title={t('notifications.log')} />
          {!data.log.length ? (
            <div className="flex flex-col items-center px-6 py-14 text-center text-sm text-muted">
              <BellRing className="mb-3 size-6" />
              {t('notifications.logEmpty')}
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {data.log.map((l) => (
                <li key={l.id} className="flex items-start gap-3 px-6 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {t(`notifications.kinds.${l.kind as 'hostnameLive'}`, { defaultValue: l.kind })} <span className="font-normal text-muted">· {l.kind === 'monthlyReport' ? l.ref : ''}</span>
                    </p>
                    <p className="truncate text-xs text-muted" title={l.error ?? undefined}>
                      {formatDate(l.createdAt)} · {l.recipients.join(', ') || '—'}
                      {l.error ? ` · ${l.error}` : ''}
                    </p>
                  </div>
                  <Badge tone={tones[l.status]}>{t(`notifications.logStatus.${l.status}`)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
