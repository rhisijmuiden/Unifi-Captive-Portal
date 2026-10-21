import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eraser, Mail, PlugZap, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Segmented, useConfirm } from '../components/controls';
import { Section } from '../components/SignInSettings';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Spinner, Switch, cx } from '../components/ui';
import { api } from '../lib/api';
import { formatDate, timeAgo } from '../lib/format';
import { useTenantScope } from '../lib/tenant';

type Provider = 'none' | 'mailchimp' | 'hubspot';
type MarketingForm = { provider: Provider; mailchimpAudienceId: string; mailchimpDoubleOptIn: boolean; autoSync: boolean; retentionDays: number };
type MarketingData = { settings: MarketingForm & { mailchimpApiKeySet: boolean; hubspotTokenSet: boolean }; ready: boolean };
type Contact = { id: string; email: string; name: string | null; phone: string | null; source: string | null; optIn: boolean; visits: number; lastSeenAt: string; syncedAt: string | null; updatedAt: string; syncError: string | null };
type Counts = { total: number; optIn: number; synced: number; failed: number };
type PrivacyRequest = { id: string; status: 'pending' | 'done'; via: 'guest' | 'admin'; sessions: number; createdAt: string; doneAt: string | null };

const RETENTION = [0, 30, 90, 180, 365, 730];

function ExportSettings({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['marketing-settings'], queryFn: () => api.get<MarketingData>('/marketing-settings') });
  const [form, setForm] = useState<MarketingForm | null>(null);
  const [secrets, setSecrets] = useState({ mailchimpApiKey: '', hubspotToken: '' });
  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);
  const body = () => ({ ...form, ...Object.fromEntries(Object.entries(secrets).filter(([, v]) => v)) });
  const save = useMutation({
    mutationFn: () => api.put<MarketingData>('/marketing-settings', body()),
    onSuccess: (d) => {
      setSecrets({ mailchimpApiKey: '', hubspotToken: '' });
      qc.setQueryData(['marketing-settings'], d);
      toast.success(t('common.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ name: string }>('/marketing-settings/test', body()),
    onSuccess: (d) => toast.success(t('marketing.testOk', { name: d.name })),
    onError: (e: Error) => toast.error(e.message),
  });
  const sync = useMutation({
    mutationFn: () => api.post<{ synced: number }>('/marketing/sync'),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['marketing-contacts'] });
      toast.success(t('marketing.synced', { count: d.synced }));
    },
    onError: (e: Error) => {
      qc.invalidateQueries({ queryKey: ['marketing-contacts'] });
      toast.error(e.message);
    },
  });
  if (!form || !data) return <Spinner />;
  const set = <K extends keyof MarketingForm>(k: K, v: MarketingForm[K]) => setForm({ ...form, [k]: v });
  const secret = (k: keyof typeof secrets, label: string, isSet: boolean, placeholder: string) => (
    <Field label={label} htmlFor={`mk-${k}`}>
      <Input id={`mk-${k}`} type="password" autoComplete="off" placeholder={isSet ? `•••••• (${t('payments.keySet')})` : placeholder} value={secrets[k]} disabled={!canManage} onChange={(e) => setSecrets({ ...secrets, [k]: e.target.value })} />
    </Field>
  );
  return (
    <Section
      title={t('marketing.export')}
      description={t('marketing.exportHint')}
      action={
        canManage && (
          <div className="flex gap-2">
            {form.provider !== 'none' && (
              <Button variant="secondary" size="sm" icon={<PlugZap className="size-4" />} loading={test.isPending} onClick={() => test.mutate()}>
                {t('signIn.test')}
              </Button>
            )}
            <Button variant="accent" size="sm" loading={save.isPending} onClick={() => save.mutate()}>
              {t('common.save')}
            </Button>
          </div>
        )
      }
    >
      <Field label={t('marketing.provider')}>
        <Segmented
          value={form.provider}
          onChange={(v) => set('provider', v)}
          options={[
            { value: 'none', label: t('marketing.providers.none') },
            { value: 'mailchimp', label: 'Mailchimp' },
            { value: 'hubspot', label: 'HubSpot' },
          ]}
        />
      </Field>
      {form.provider === 'mailchimp' && (
        <div className="grid gap-4 sm:grid-cols-2">
          {secret('mailchimpApiKey', t('marketing.mailchimpKey'), data.settings.mailchimpApiKeySet, '0123456789abcdef-us21')}
          <Field label={t('marketing.audienceId')} htmlFor="mk-aud" hint={t('marketing.audienceIdHint')}>
            <Input id="mk-aud" autoComplete="off" placeholder="a1b2c3d4e5" value={form.mailchimpAudienceId} disabled={!canManage} onChange={(e) => set('mailchimpAudienceId', e.target.value.trim())} />
          </Field>
          <div className="sm:col-span-2">
            <Switch checked={form.mailchimpDoubleOptIn} onChange={(v) => set('mailchimpDoubleOptIn', v)} label={t('marketing.doubleOptIn')} description={t('marketing.doubleOptInHint')} />
          </div>
        </div>
      )}
      {form.provider === 'hubspot' && (
        <div className="grid gap-4 sm:grid-cols-2">
          {secret('hubspotToken', t('marketing.hubspotToken'), data.settings.hubspotTokenSet, 'pat-eu1-…')}
          <p className="self-end text-xs text-muted">{t('marketing.hubspotHint')}</p>
        </div>
      )}
      {form.provider !== 'none' && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-sunken p-4">
          <div className="flex-1">
            <Switch checked={form.autoSync} onChange={(v) => set('autoSync', v)} label={t('marketing.autoSync')} description={t('marketing.autoSyncHint')} />
          </div>
          {canManage && data.ready && (
            <Button variant="secondary" size="sm" icon={<RefreshCw className="size-4" />} loading={sync.isPending} onClick={() => sync.mutate()}>
              {t('marketing.syncNow')}
            </Button>
          )}
        </div>
      )}
      <Field label={t('marketing.retention')} hint={t('marketing.retentionHint')}>
        <Select value={form.retentionDays} disabled={!canManage} onChange={(e) => set('retentionDays', Number(e.target.value))}>
          {(RETENTION.includes(form.retentionDays) ? RETENTION : [...RETENTION, form.retentionDays]).map((d) => (
            <option key={d} value={d}>
              {d ? t('marketing.days', { count: d }) : t('marketing.keep')}
            </option>
          ))}
        </Select>
      </Field>
    </Section>
  );
}

function Privacy({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [dialog, ask] = useConfirm();
  const { data } = useQuery({ queryKey: ['privacy-requests'], queryFn: () => api.get<{ requests: PrivacyRequest[] }>('/marketing/privacy-requests') });
  const forget = useMutation({
    mutationFn: () => api.post<{ sessions: number; contacts: number; providerError: string | null }>('/marketing/forget', { email }),
    onSuccess: (d) => {
      setEmail('');
      qc.invalidateQueries({ queryKey: ['privacy-requests'] });
      qc.invalidateQueries({ queryKey: ['marketing-contacts'] });
      if (d.providerError) toast.warning(t('marketing.forgotProviderError', { error: d.providerError }));
      else toast.success(t('marketing.forgot', { count: d.sessions }));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const requests = data?.requests ?? [];
  return (
    <Card>
      <CardHeader title={t('marketing.privacy')} description={t('marketing.privacyHint')} />
      <div className="space-y-5 p-6">
        {canManage && (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await ask(t('marketing.forgetConfirm', { email }))) forget.mutate();
            }}
          >
            <Input type="email" required className="min-w-56 flex-1" placeholder={t('marketing.forgetPlaceholder')} value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button type="submit" variant="danger" icon={<Eraser className="size-4" />} loading={forget.isPending}>
              {t('marketing.forget')}
            </Button>
          </form>
        )}
        {!requests.length ? (
          <p className="text-sm text-muted">{t('marketing.noRequests')}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {requests.slice(0, 20).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <ShieldCheck className={cx('size-4', r.status === 'done' ? 'text-online' : 'text-muted')} />
                <span className="flex-1">
                  {r.via === 'admin' ? t('marketing.viaAdmin') : t('marketing.viaGuest')}
                  {r.status === 'done' && <span className="text-muted"> · {t('marketing.erasedVisits', { count: r.sessions })}</span>}
                </span>
                <Badge tone={r.status === 'done' ? 'online' : 'neutral'}>{t(`marketing.status.${r.status}`)}</Badge>
                <span className="w-32 text-right text-xs text-muted">{formatDate(r.doneAt ?? r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {dialog}
    </Card>
  );
}

export function MarketingPage() {
  const { t } = useTranslation();
  const scope = useTenantScope();
  const [onlyOptIn, setOnlyOptIn] = useState(true);
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['marketing-contacts', onlyOptIn], queryFn: () => api.get<{ contacts: Contact[]; counts: Counts }>(`/marketing/contacts${onlyOptIn ? '?optIn=1' : ''}`) });
  const contacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.contacts ?? []).filter((c) => !q || c.email.includes(q) || (c.name ?? '').toLowerCase().includes(q));
  }, [data, search]);
  const counts = data?.counts;
  const tiles = [
    { label: t('marketing.contacts'), value: counts?.total },
    { label: t('marketing.optIns'), value: counts?.optIn },
    { label: t('marketing.syncedCount'), value: counts?.synced },
  ];

  return (
    <>
      <PageHeader
        eyebrow={t('nav.marketing')}
        title={t('marketing.title')}
        description={t('marketing.description')}
        actions={
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => location.assign(`/api/marketing/contacts?format=csv${onlyOptIn ? '&optIn=1' : ''}`)}>
            {t('marketing.download')}
          </Button>
        }
      />
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {tiles.map((tile) => (
            <Card key={tile.label} className="p-5">
              <p className="text-sm text-muted">{tile.label}</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{tile.value ?? '–'}</p>
            </Card>
          ))}
        </div>
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
            <div className="flex gap-1 rounded-xl bg-sunken p-1">
              {[true, false].map((v) => (
                <button key={String(v)} onClick={() => setOnlyOptIn(v)} className={cx('rounded-lg px-3 py-1.5 text-sm font-medium transition', onlyOptIn === v ? 'bg-raised shadow-card' : 'text-muted hover:text-ink')}>
                  {v ? t('marketing.filterOptIn') : t('marketing.filterAll')}
                </button>
              ))}
            </div>
            <div className="relative min-w-48 flex-1">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <Input className="pl-9" placeholder={t('marketing.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          {isLoading ? (
            <Spinner />
          ) : !contacts.length ? (
            <EmptyState icon={<Mail className="size-6" />} title={t('marketing.empty')} description={t('marketing.emptyHint')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs font-semibold tracking-wide text-muted uppercase">
                  <tr className="border-b border-line">
                    <th className="px-6 py-3">{t('marketing.email')}</th>
                    <th className="px-3 py-3">{t('marketing.name')}</th>
                    <th className="px-3 py-3">{t('marketing.visits')}</th>
                    <th className="px-3 py-3">{t('marketing.lastSeen')}</th>
                    <th className="px-6 py-3">{t('marketing.newsletter')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {contacts.map((c) => (
                    <tr key={c.id} className="hover:bg-sunken/50">
                      <td className="px-6 py-3 font-medium">{c.email}</td>
                      <td className="px-3 py-3 text-muted">{c.name ?? '–'}</td>
                      <td className="px-3 py-3 tabular-nums">{c.visits}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-muted">{timeAgo(c.lastSeenAt)}</td>
                      <td className="px-6 py-3">
                        {!c.optIn ? (
                          <span className="text-muted">–</span>
                        ) : c.syncError ? (
                          <span title={c.syncError}>
                            <Badge tone="offline">{t('marketing.syncError')}</Badge>
                          </span>
                        ) : c.syncedAt && c.syncedAt >= c.updatedAt ? (
                          <Badge tone="online">{t('marketing.sent')}</Badge>
                        ) : (
                          <Badge tone="info">{t('marketing.optedIn')}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="grid gap-6 xl:grid-cols-2">
          <ExportSettings canManage={scope.canManage} />
          <Privacy canManage={scope.canManage} />
        </div>
      </div>
    </>
  );
}
