import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Check, Cloud, Copy, Network, Pencil, Plus, RefreshCw, Router, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, StatusDot, Switch, cx } from '../components/ui';
import { api } from '../lib/api';
import { guideUrl } from '../lib/docs';
import { timeAgo } from '../lib/format';
import { ChooseTenant, TenantPicker, useTenantScope } from '../lib/tenant';

type Site = { id: string; unifiSiteId: string; siteName: string; displayName: string; enabled: boolean; deviceCount: number };
type UnifiConsole = {
  id: string;
  name: string;
  connection: 'site_manager' | 'direct';
  hostId: string | null;
  baseUrl: string | null;
  verifyTls: boolean;
  status: 'unknown' | 'ok' | 'error';
  lastError: string | null;
  lastSyncAt: string | null;
  sites: Site[];
};
type UnifiSite = { id: string; internalReference: string; name: string };
type Host = { id: string; name: string; model: string | null; version: string | null };

type Scope = ReturnType<typeof useTenantScope>;

function SitePicker({ sites, selected, onChange }: { sites: UnifiSite[]; selected: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="space-y-2">
      {sites.map((s) => {
        const on = selected.includes(s.id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(on ? selected.filter((x) => x !== s.id) : [...selected, s.id])}
            className={cx('flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition', on ? 'border-koraal bg-koraal/8' : 'border-line hover:border-muted')}
          >
            <span className={cx('grid size-5 place-items-center rounded-md border', on ? 'border-koraal bg-koraal text-nacht' : 'border-line')}>{on && <Check className="size-3.5" />}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{s.name || s.internalReference}</span>
              <span className="block font-mono text-xs text-muted">{s.internalReference}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ConnectWizard({ scope, onClose }: { scope: Scope; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [step, setStep] = useState<'method' | 'details' | 'sites'>('method');
  const [form, setForm] = useState({ connection: 'site_manager' as UnifiConsole['connection'], apiKey: '', hostId: '', baseUrl: 'https://', verifyTls: false, name: '' });
  const [hosts, setHosts] = useState<Host[] | null>(null);
  const [sites, setSites] = useState<UnifiSite[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  const discover = useMutation({
    mutationFn: () => api.post<{ hosts: Host[] }>('/consoles/discover', { ...scope.body, apiKey: form.apiKey }),
    onSuccess: (d) => {
      setHosts(d.hosts);
      if (d.hosts.length === 1) setForm((f) => ({ ...f, hostId: d.hosts[0].id, name: f.name || d.hosts[0].name }));
    },
  });
  const test = useMutation({
    mutationFn: () => api.post<{ sites: UnifiSite[] }>('/consoles/test', { ...scope.body, ...form }),
    onSuccess: (d) => {
      setSites(d.sites);
      setSelected(d.sites.length === 1 ? [d.sites[0].id] : []);
      setStep('sites');
    },
  });
  const save = useMutation({
    mutationFn: () =>
      api.post<{ sync: { ok: boolean; error?: string } }>('/consoles', {
        ...scope.body,
        ...form,
        name: form.name || t('consoles.defaultName'),
        sites: sites.filter((s) => selected.includes(s.id)),
      }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['consoles'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (d.sync.ok) toast.success(t('consoles.connected'));
      else toast.warning(t('consoles.connectedSyncFailed', { error: d.sync.error }));
      onClose();
    },
  });

  const methods = [
    { id: 'site_manager' as const, icon: Cloud, title: t('consoles.siteManager'), text: t('consoles.siteManagerText'), badge: t('consoles.recommended') },
    { id: 'direct' as const, icon: Network, title: t('consoles.direct'), text: t('consoles.directText') },
  ];
  const error = discover.error ?? test.error ?? save.error;

  const footer =
    step === 'method' ? (
      <>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="accent" onClick={() => setStep('details')}>
          {t('consoles.next')}
        </Button>
      </>
    ) : step === 'details' ? (
      <>
        <Button variant="ghost" onClick={() => setStep('method')}>
          {t('consoles.back')}
        </Button>
        <Button
          variant="accent"
          loading={test.isPending}
          disabled={!form.apiKey || (form.connection === 'site_manager' ? !form.hostId : form.baseUrl.length < 10)}
          onClick={() => test.mutate()}
        >
          {t('consoles.testConnection')}
        </Button>
      </>
    ) : (
      <>
        <Button variant="ghost" onClick={() => setStep('details')}>
          {t('consoles.back')}
        </Button>
        <Button variant="accent" loading={save.isPending} disabled={!selected.length} onClick={() => save.mutate()}>
          {t('consoles.connect')}
        </Button>
      </>
    );

  return (
    <Modal open onClose={onClose} wide title={t('consoles.connectTitle')} description={t(`consoles.step.${step}`)} footer={footer}>
      {step === 'method' && (
        <div className="grid gap-3 sm:grid-cols-2">
          {methods.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setForm({ ...form, connection: m.id })}
              className={cx('rounded-2xl border p-5 text-left transition', form.connection === m.id ? 'border-koraal bg-koraal/8 ring-4 ring-koraal/10' : 'border-line hover:border-muted')}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-xl bg-lucht/25 text-nacht dark:text-lucht">
                  <m.icon className="size-5" />
                </span>
                {m.badge && <Badge tone="accent">{m.badge}</Badge>}
              </div>
              <p className="font-semibold">{m.title}</p>
              <p className="mt-1 text-sm text-muted">{m.text}</p>
            </button>
          ))}
          <a href={guideUrl('unifi', i18n.resolvedLanguage)} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-accent hover:underline sm:col-span-2">
            <BookOpen className="size-4" /> {t('consoles.guideLink')}
          </a>
        </div>
      )}

      {step === 'details' && (
        <div className="space-y-4">
          <Field label={t('consoles.apiKey')} htmlFor="c-key" hint={form.connection === 'site_manager' ? t('consoles.apiKeySiteManagerHint') : t('consoles.apiKeyDirectHint')}>
            <Input id="c-key" type="password" autoComplete="off" autoFocus value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value.trim() })} />
          </Field>
          {form.connection === 'site_manager' ? (
            <>
              <Button variant="secondary" icon={<Search className="size-4" />} loading={discover.isPending} disabled={form.apiKey.length < 10} onClick={() => discover.mutate()}>
                {t('consoles.findConsoles')}
              </Button>
              {hosts && !hosts.length && <p className="text-sm text-muted">{t('consoles.noHosts')}</p>}
              {hosts && hosts.length > 0 && (
                <div className="space-y-2">
                  {hosts.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => setForm({ ...form, hostId: h.id, name: form.name || h.name })}
                      className={cx('flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition', form.hostId === h.id ? 'border-koraal bg-koraal/8' : 'border-line hover:border-muted')}
                    >
                      <Router className="size-5 text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{h.name}</span>
                        <span className="block text-xs text-muted">{[h.model, h.version && `UniFi OS ${h.version}`].filter(Boolean).join(' · ')}</span>
                      </span>
                      {form.hostId === h.id && <Check className="size-4 text-accent" />}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <Field label={t('consoles.baseUrl')} htmlFor="c-url" hint={t('consoles.baseUrlHint')}>
                <Input id="c-url" placeholder="https://192.168.1.1" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value.trim() })} />
              </Field>
              <Switch checked={form.verifyTls} onChange={(v) => setForm({ ...form, verifyTls: v })} label={t('consoles.verifyTls')} description={t('consoles.verifyTlsHint')} />
            </>
          )}
        </div>
      )}

      {step === 'sites' && (
        <div className="space-y-4">
          <Field label={t('consoles.name')} htmlFor="c-name">
            <Input id="c-name" value={form.name} placeholder={t('consoles.defaultName')} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div>
            <p className="mb-2 text-sm font-medium">{t('consoles.chooseSites')}</p>
            <SitePicker sites={sites} selected={selected} onChange={setSelected} />
          </div>
        </div>
      )}
      {error && <p className="mt-4 text-sm text-offline">{error.message}</p>}
    </Modal>
  );
}

function EditConsole({ scope, console: c, onClose }: { scope: Scope; console: UnifiConsole; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(c.name);
  const [apiKey, setApiKey] = useState('');
  const [verifyTls, setVerifyTls] = useState(c.verifyTls);
  const sites = useQuery({
    queryKey: ['console-sites', c.id, apiKey],
    queryFn: () => api.post<{ sites: UnifiSite[] }>('/consoles/test', { ...scope.body, consoleId: c.id, apiKey: apiKey || undefined, connection: c.connection, hostId: c.hostId, baseUrl: c.baseUrl, verifyTls }),
    enabled: false,
  });
  const [selected, setSelected] = useState(c.sites.filter((s) => s.enabled).map((s) => s.unifiSiteId));
  const save = useMutation({
    mutationFn: () =>
      api.put<{ sync: { ok: boolean; error?: string } }>(`/consoles/${c.id}`, {
        ...scope.body,
        name,
        verifyTls,
        apiKey: apiKey || undefined,
        sites: sites.data ? sites.data.sites.filter((s) => selected.includes(s.id)) : undefined,
      }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['consoles'] });
      if (d.sync.ok) toast.success(t('consoles.updated'));
      else toast.warning(t('consoles.connectedSyncFailed', { error: d.sync.error }));
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t('consoles.editTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="accent" loading={save.isPending} disabled={Boolean(sites.data) && !selected.length} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('consoles.name')} htmlFor="e-name">
          <Input id="e-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('consoles.newApiKey')} htmlFor="e-key" hint={t('consoles.newApiKeyHint')}>
          <Input id="e-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value.trim())} />
        </Field>
        {c.connection === 'direct' && <Switch checked={verifyTls} onChange={setVerifyTls} label={t('consoles.verifyTls')} description={t('consoles.verifyTlsHint')} />}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">{t('consoles.sites')}</p>
            <Button variant="secondary" size="sm" icon={<RefreshCw className="size-3.5" />} loading={sites.isFetching} onClick={() => sites.refetch()}>
              {t('consoles.loadSites')}
            </Button>
          </div>
          {sites.data ? (
            <SitePicker sites={sites.data.sites} selected={selected} onChange={setSelected} />
          ) : (
            <p className="text-sm text-muted">{c.sites.filter((s) => s.enabled).map((s) => s.displayName).join(', ')}</p>
          )}
          {sites.error && <p className="mt-2 text-sm text-offline">{sites.error.message}</p>}
        </div>
        {save.error && <p className="text-sm text-offline">{save.error.message}</p>}
      </div>
    </Modal>
  );
}

export function ConsolesPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const scope = useTenantScope();
  const [wizard, setWizard] = useState(false);
  const [editing, setEditing] = useState<UnifiConsole | null>(null);
  const [deleting, setDeleting] = useState<UnifiConsole | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['consoles', scope.tenantId],
    queryFn: () => api.get<{ consoles: UnifiConsole[]; portalAddress: string | null }>(`/consoles${scope.qs}`),
    enabled: Boolean(scope.tenantId),
  });
  const sync = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; error?: string }>(`/consoles/${id}/sync${scope.qs}`),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['consoles'] });
      if (d.ok) toast.success(t('consoles.synced'));
      else toast.error(d.error);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/consoles/${id}${scope.qs}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['consoles'] });
      toast.success(t('consoles.deleted'));
      setDeleting(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success(t('common.copied')));
  const consoles = data?.consoles ?? [];

  return (
    <>
      <PageHeader
        eyebrow={t('nav.portals')}
        title={t('consoles.title')}
        description={t('consoles.description')}
        actions={
          <>
            <TenantPicker scope={scope} />
            {scope.canManage && scope.tenantId && (
              <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setWizard(true)}>
                {t('consoles.add')}
              </Button>
            )}
          </>
        }
      />
      {!scope.tenantId ? (
        scope.loading ? <Spinner /> : <Card><ChooseTenant /></Card>
      ) : isLoading ? (
        <Spinner />
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            {!consoles.length ? (
              <Card>
                <EmptyState
                  icon={<Router className="size-6" />}
                  title={t('consoles.empty')}
                  description={t('consoles.emptyHint')}
                  action={scope.canManage && <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setWizard(true)}>{t('consoles.add')}</Button>}
                />
              </Card>
            ) : (
              consoles.map((c) => (
                <Card key={c.id} className="p-5">
                  <div className="flex flex-wrap items-start gap-4">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-lucht/25 text-nacht dark:text-lucht">
                      {c.connection === 'site_manager' ? <Cloud className="size-5" /> : <Network className="size-5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{c.name}</p>
                        {c.status === 'ok' ? <Badge tone="online"><StatusDot tone="online" /> {t('consoles.statusOk')}</Badge> : c.status === 'error' ? <Badge tone="offline"><StatusDot tone="offline" /> {t('consoles.statusError')}</Badge> : <Badge>{t('consoles.statusUnknown')}</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        {c.connection === 'site_manager' ? t('consoles.viaSiteManager') : c.baseUrl} · {c.lastSyncAt ? t('consoles.lastSync', { time: timeAgo(c.lastSyncAt) }) : t('consoles.neverSynced')}
                      </p>
                      {c.lastError && <p className="mt-2 rounded-lg bg-offline/10 px-3 py-2 text-xs text-offline">{c.lastError}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {c.sites.filter((s) => s.enabled).map((s) => (
                          <span key={s.id} className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-line px-3 py-1 text-xs">
                            <span className="font-medium">{s.displayName}</span>
                            <span className="text-muted">{t('consoles.accessPoints', { count: s.deviceCount })}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    {scope.canManage && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => sync.mutate(c.id)} loading={sync.isPending && sync.variables === c.id} aria-label={t('consoles.sync')}>
                          {!(sync.isPending && sync.variables === c.id) && <RefreshCw className="size-4" />}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(c)} aria-label={t('common.edit')}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleting(c)} aria-label={t('common.delete')}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              ))
            )}
          </div>

          <Card className="h-fit p-6">
            <h2 className="font-semibold">{t('consoles.setupTitle')}</h2>
            <p className="mt-1 text-sm text-muted">{t('consoles.setupIntro')}</p>
            <ol className="mt-4 space-y-3 text-sm">
              {(['setup1', 'setup2', 'setup3', 'setup4'] as const).map((k, i) => (
                <li key={k} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-koraal/15 text-xs font-bold text-accent">{i + 1}</span>
                  <span>{t(`consoles.${k}`)}</span>
                </li>
              ))}
            </ol>
            <div className="mt-5 rounded-xl border border-line bg-surface p-4">
              <p className="text-xs text-muted">{t('consoles.portalAddress')}</p>
              {data?.portalAddress ? (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <code className="font-mono text-base font-semibold">{data.portalAddress}</code>
                  <Button variant="ghost" size="sm" onClick={() => copy(data.portalAddress!)} aria-label={t('common.copy')}>
                    <Copy className="size-4" />
                  </Button>
                </div>
              ) : (
                <p className="mt-1 text-sm text-warning">{t('consoles.portalAddressMissing')}</p>
              )}
            </div>
            <a href={guideUrl('unifi', i18n.resolvedLanguage)} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-2 text-sm text-accent hover:underline">
              <BookOpen className="size-4" /> {t('consoles.guideLink')}
            </a>
          </Card>
        </div>
      )}

      {wizard && <ConnectWizard scope={scope} onClose={() => setWizard(false)} />}
      {editing && <EditConsole scope={scope} console={editing} onClose={() => setEditing(null)} />}
      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={t('consoles.deleteTitle')}
        description={t('consoles.deleteText', { name: deleting?.name })}
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
        <p className="text-sm text-muted">{t('consoles.deleteTip')}</p>
      </Modal>
    </>
  );
}
