import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  BookOpen,
  ChevronDown,
  Download,
  Eye,
  History,
  KeyRound,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Send,
  Trash2,
  TriangleAlert,
  Webhook as WebhookIcon,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Copyable, Segmented, useConfirm } from '../components/controls';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Switch, Textarea, cx } from '../components/ui';
import { currentLocale } from '../i18n';
import { api } from '../lib/api';
import { formatDate, timeAgo } from '../lib/format';

type Audience = 'tenant' | 'platform';
type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  rateLimit: number;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  requestCount: number;
  createdAt: string;
  createdByName: string | null;
  status: 'active' | 'expired' | 'revoked';
};
type KeysResponse = { audience: Audience; keys: ApiKey[]; scopes: { name: string; label: string }[]; baseUrl: string };
type Webhook = {
  id: string;
  url: string;
  description: string;
  events: string[];
  active: boolean;
  failures: number;
  disabledReason: string | null;
  lastDeliveryAt: string | null;
  createdAt: string;
};
type Delivery = {
  id: string;
  event: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  nextAttemptAt: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
};

const methodTone = { GET: 'info', POST: 'online', PUT: 'warning', DELETE: 'offline' } as const;
const MethodBadge = ({ method }: { method: string }) => (
  <span className="inline-block w-16 shrink-0">
    <Badge tone={methodTone[method as keyof typeof methodTone] ?? 'neutral'}>{method}</Badge>
  </span>
);

/** Server error keys (errors.webhookPrivate) inside a delivery are shown translated. */
function useErrorText() {
  const { t } = useTranslation();
  return (e: string | null) => (e && e.startsWith('errors.') ? t(`api.deliveryErrors.${e.slice(7)}` as 'api.deliveryErrors.webhookPrivate', { defaultValue: e }) : e);
}

// ── Keys ─────────────────────────────────────────────────────────────────────

type Access = 'none' | 'read' | 'write';
const accessOf = (scopes: string[], resource: string): Access => (scopes.includes(`${resource}:write`) ? 'write' : scopes.includes(`${resource}:read`) ? 'read' : 'none');

function KeyDialog({ open, onClose, data, edit, onCreated }: { open: boolean; onClose: () => void; data: KeysResponse; edit: ApiKey | null; onCreated: (token: string, key: ApiKey) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(edit?.name ?? '');
  const [access, setAccess] = useState<Record<string, Access>>(() => Object.fromEntries(data.scopes.map((s) => [s.name, edit ? accessOf(edit.scopes, s.name) : 'none'])));
  const [rateLimit, setRateLimit] = useState(String(edit?.rateLimit ?? 120));
  const [expiry, setExpiry] = useState(edit ? (edit.expiresAt ? 'date' : 'never') : '90');
  const [date, setDate] = useState(edit?.expiresAt ? edit.expiresAt.slice(0, 10) : '');
  const scopes = Object.entries(access).flatMap(([r, a]) => (a === 'none' ? [] : [`${r}:${a}`]));
  const expiresAt = () => {
    if (expiry === 'never') return null;
    if (expiry === 'date') return date ? new Date(`${date}T23:59:59`).toISOString() : null;
    return new Date(Date.now() + Number(expiry) * 86_400_000).toISOString();
  };
  const save = useMutation({
    mutationFn: (): Promise<{ key: ApiKey; token?: string }> => {
      const body = { name, scopes, rateLimit: Number(rateLimit), expiresAt: expiresAt() };
      return edit ? api.put(`/api-keys/${edit.id}`, body) : api.post('/api-keys', body);
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['api-keys'] });
      onClose();
      if (d.token) onCreated(d.token, d.key);
      else toast.success(t('api.keySaved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setAll = (a: Access) => setAccess(Object.fromEntries(data.scopes.map((s) => [s.name, a])));
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={edit ? t('api.editKey') : t('api.newKey')}
      description={t(data.audience === 'platform' ? 'api.keyIntroPlatform' : 'api.keyIntroTenant')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="accent" loading={save.isPending} disabled={!name.trim() || !scopes.length} onClick={() => save.mutate()}>
            {edit ? t('common.save') : t('api.createKey')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('api.keyName')} htmlFor="k-name" hint={t('api.keyNameHint')}>
          <Input id="k-name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t('api.rateLimit')} htmlFor="k-rate" hint={t('api.rateLimitHint')}>
          <Input id="k-rate" type="number" min={1} max={10000} value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} />
        </Field>
        <Field label={t('api.expires')} htmlFor="k-exp">
          <Select id="k-exp" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            {!edit && (
              <>
                <option value="30">{t('api.expiresDays', { count: 30 })}</option>
                <option value="90">{t('api.expiresDays', { count: 90 })}</option>
                <option value="365">{t('api.expiresYear')}</option>
              </>
            )}
            <option value="date">{t('api.expiresDate')}</option>
            <option value="never">{t('api.expiresNever')}</option>
          </Select>
        </Field>
        {expiry === 'date' && (
          <Field label={t('api.expiresOn')} htmlFor="k-date">
            <Input id="k-date" type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
      </div>
      <div className="mt-6 mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{t('api.scopes')}</p>
          <p className="text-xs text-muted">{t('api.scopesHint')}</p>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setAll('read')}>
            {t('api.allRead')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAll('write')}>
            {t('api.allWrite')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAll('none')}>
            {t('api.allNone')}
          </Button>
        </div>
      </div>
      <div className="divide-y divide-line rounded-xl border border-line">
        {data.scopes.map((s) => (
          <div key={s.name} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">{s.label}</p>
              <p className="font-mono text-[11px] text-muted">{s.name}</p>
            </div>
            <div className="w-full sm:w-64">
              <Segmented
                label={s.label}
                value={access[s.name]}
                onChange={(v) => setAccess({ ...access, [s.name]: v })}
                options={[
                  { value: 'none', label: t('api.accessNone') },
                  { value: 'read', label: t('api.accessRead') },
                  { value: 'write', label: t('api.accessWrite') },
                ]}
              />
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function TokenDialog({ token, baseUrl, onClose }: { token: string | null; baseUrl: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal open={Boolean(token)} onClose={onClose} wide title={t('api.tokenTitle')} footer={<Button onClick={onClose}>{t('api.tokenDone')}</Button>}>
      <p className="mb-3 flex gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        {t('api.tokenOnce')}
      </p>
      {token && <Copyable value={token} />}
      <p className="mt-5 mb-1.5 text-sm font-medium">{t('api.tryIt')}</p>
      <pre className="overflow-x-auto rounded-xl bg-nacht p-4 font-mono text-xs leading-relaxed text-white/90">{`curl ${baseUrl}/dashboard \\\n  -H "Authorization: Bearer ${token ?? ''}"`}</pre>
    </Modal>
  );
}

function ActivityDialog({ apiKey, onClose }: { apiKey: ApiKey | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['api-keys', apiKey?.id, 'activity'],
    enabled: Boolean(apiKey),
    queryFn: () =>
      api.get<{ requests: { id: string; method: string; path: string; status: number; durationMs: number; ip: string | null; createdAt: string }[]; changes: { id: string; action: string; createdAt: string }[]; keepDays: number }>(
        `/api-keys/${apiKey!.id}/activity`,
      ),
  });
  return (
    <Modal open={Boolean(apiKey)} onClose={onClose} wide title={t('api.activityTitle', { name: apiKey?.name })} description={data && t('api.activityHint', { days: data.keepDays })}>
      {isLoading || !data ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          {data.changes.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold">{t('api.changes')}</p>
              <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                {data.changes.map((c) => (
                  <li key={c.id} className="flex justify-between gap-3 px-4 py-2">
                    <span className="font-mono text-xs">{c.action}</span>
                    <span className="text-xs text-muted">{formatDate(c.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="mb-2 text-sm font-semibold">{t('api.requests')}</p>
            {!data.requests.length ? (
              <p className="text-sm text-muted">{t('api.noRequests')}</p>
            ) : (
              <div className="max-h-[50vh] overflow-auto rounded-xl border border-line">
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-line">
                    {data.requests.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2">
                          <MethodBadge method={r.method} />
                        </td>
                        <td className="max-w-[16rem] truncate px-3 py-2 font-mono" title={r.path}>
                          {r.path}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={r.status < 300 ? 'online' : r.status < 500 ? 'warning' : 'offline'}>{r.status}</Badge>
                        </td>
                        <td className="hidden px-3 py-2 text-muted sm:table-cell">{r.durationMs} ms</td>
                        <td className="hidden px-3 py-2 text-muted md:table-cell">{r.ip}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap text-muted">{formatDate(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Keys() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [confirmDialog, ask] = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ['api-keys'], queryFn: () => api.get<KeysResponse>('/api-keys') });
  const [dialog, setDialog] = useState<{ edit: ApiKey | null } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [activity, setActivity] = useState<ApiKey | null>(null);
  const action = useMutation({
    mutationFn: ({ key, kind }: { key: ApiKey; kind: 'revoke' | 'delete' }) => (kind === 'revoke' ? api.post(`/api-keys/${key.id}/revoke`) : api.del(`/api-keys/${key.id}`)),
    onSuccess: (_d, { kind }) => {
      qc.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success(kind === 'revoke' ? t('api.keyRevoked') : t('api.keyDeleted'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (isLoading || !data) return <Spinner />;
  const tones = { active: 'online', expired: 'warning', revoked: 'offline' } as const;
  return (
    <>
      <Card className="mb-6 p-6">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="text-sm font-semibold">{t('api.baseUrl')}</p>
            <p className="mb-2 text-xs text-muted">{t('api.baseUrlHint')}</p>
            <Copyable value={data.baseUrl} />
          </div>
          <Button variant="accent" icon={<Plus className="size-4" />} onClick={() => setDialog({ edit: null })}>
            {t('api.newKey')}
          </Button>
        </div>
      </Card>
      <Card>
        <CardHeader title={t('api.keys')} description={t(data.audience === 'platform' ? 'api.keysHintPlatform' : 'api.keysHintTenant')} />
        {!data.keys.length ? (
          <EmptyState icon={<KeyRound className="size-6" />} title={t('api.noKeys')} description={t('api.noKeysHint')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-6 py-3 font-medium">{t('api.keyName')}</th>
                  <th className="px-6 py-3 font-medium">{t('api.status')}</th>
                  <th className="hidden px-6 py-3 font-medium md:table-cell">{t('api.scopes')}</th>
                  <th className="hidden px-6 py-3 font-medium lg:table-cell">{t('api.lastUsed')}</th>
                  <th className="hidden px-6 py-3 font-medium lg:table-cell">{t('api.expires')}</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.keys.map((k) => (
                  <tr key={k.id} className="transition hover:bg-sunken/50">
                    <td className="px-6 py-3">
                      <p className="font-medium">{k.name}</p>
                      <p className="font-mono text-xs text-muted">{k.prefix}…</p>
                    </td>
                    <td className="px-6 py-3">
                      <Badge tone={tones[k.status]}>{t(`api.keyStatus.${k.status}`)}</Badge>
                    </td>
                    <td className="hidden px-6 py-3 md:table-cell">
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <span key={s} className={cx('rounded-md px-1.5 py-0.5 font-mono text-[11px]', s.endsWith(':write') ? 'bg-koraal/12 text-accent' : 'bg-sunken text-muted')}>
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="hidden px-6 py-3 text-muted lg:table-cell">
                      {k.lastUsedAt ? (
                        <>
                          <p>{timeAgo(k.lastUsedAt)}</p>
                          <p className="text-xs">{t('api.requestCount', { count: k.requestCount })}</p>
                        </>
                      ) : (
                        t('api.neverUsed')
                      )}
                    </td>
                    <td className="hidden px-6 py-3 text-muted lg:table-cell">{k.expiresAt ? formatDate(k.expiresAt) : t('api.expiresNever')}</td>
                    <td className="px-6 py-3 text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" title={t('api.activity')} aria-label={t('api.activity')} onClick={() => setActivity(k)}>
                        <History className="size-4" />
                      </Button>
                      {k.status !== 'revoked' && (
                        <Button variant="ghost" size="sm" title={t('common.edit')} aria-label={t('common.edit')} onClick={() => setDialog({ edit: k })}>
                          <Pencil className="size-4" />
                        </Button>
                      )}
                      {k.status === 'active' && (
                        <Button variant="ghost" size="sm" title={t('api.revoke')} aria-label={t('api.revoke')} onClick={async () => (await ask(t('api.confirmRevoke', { name: k.name }))) && action.mutate({ key: k, kind: 'revoke' })}>
                          <Ban className="size-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" title={t('common.delete')} aria-label={t('common.delete')} onClick={async () => (await ask(t('api.confirmDeleteKey', { name: k.name }))) && action.mutate({ key: k, kind: 'delete' })}>
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {dialog && <KeyDialog open onClose={() => setDialog(null)} data={data} edit={dialog.edit} onCreated={(tk) => setToken(tk)} />}
      <TokenDialog token={token} baseUrl={data.baseUrl} onClose={() => setToken(null)} />
      <ActivityDialog apiKey={activity} onClose={() => setActivity(null)} />
      {confirmDialog}
    </>
  );
}

// ── Webhooks ─────────────────────────────────────────────────────────────────

const verifySnippet = `import { createHmac, timingSafeEqual } from 'node:crypto';

// rawBody: the request body exactly as received (a string)
function verify(rawBody, headers, secret) {
  const ts = headers['x-webhook-timestamp'];
  const expected = 'v1=' + createHmac('sha256', secret).update(\`\${ts}.\${rawBody}\`).digest('hex');
  const given = headers['x-webhook-signature'] ?? '';
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300;
  return fresh && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}`;

function SecretDialog({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal open={Boolean(secret)} onClose={onClose} wide title={t('api.secretTitle')} description={t('api.secretHint')} footer={<Button onClick={onClose}>{t('api.tokenDone')}</Button>}>
      {secret && <Copyable value={secret} />}
      <p className="mt-5 mb-1.5 text-sm font-medium">{t('api.verifyTitle')}</p>
      <pre className="overflow-x-auto rounded-xl bg-nacht p-4 font-mono text-xs leading-relaxed text-white/90">{verifySnippet}</pre>
    </Modal>
  );
}

function WebhookDialog({ edit, events, audience, onClose, onCreated }: { edit: Webhook | null; events: { name: string; label: string }[]; audience: Audience; onClose: () => void; onCreated: (secret: string) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [url, setUrl] = useState(edit?.url ?? '');
  const [description, setDescription] = useState(edit?.description ?? '');
  const [selected, setSelected] = useState<string[]>(edit?.events ?? []);
  const [active, setActive] = useState(edit?.active ?? true);
  const save = useMutation({
    mutationFn: (): Promise<{ webhook: Webhook; secret?: string }> => {
      const body = { url, description, events: selected, active };
      return edit ? api.put(`/webhooks/${edit.id}`, body) : api.post('/webhooks', body);
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['webhooks'] });
      onClose();
      if (d.secret) onCreated(d.secret);
      else toast.success(t('api.webhookSaved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = (name: string) => setSelected(selected.includes(name) ? selected.filter((e) => e !== name) : [...selected, name]);
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={edit ? t('api.editWebhook') : t('api.newWebhook')}
      description={t(audience === 'platform' ? 'api.webhookIntroPlatform' : 'api.webhookIntroTenant')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="accent" loading={save.isPending} disabled={!url.trim() || !selected.length} onClick={() => save.mutate()}>
            {edit ? t('common.save') : t('api.createWebhook')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('api.webhookUrl')} htmlFor="w-url" hint={t(audience === 'platform' ? 'api.webhookUrlHintPlatform' : 'api.webhookUrlHint')}>
          <Input id="w-url" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
        </Field>
        <Field label={t('api.webhookDescription')} htmlFor="w-desc">
          <Input id="w-desc" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">{t('api.events')}</p>
            <Button size="sm" variant="ghost" onClick={() => setSelected(selected.length === events.length ? [] : events.map((e) => e.name))}>
              {selected.length === events.length ? t('api.allNone') : t('api.allEvents')}
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {events.map((e) => (
              <label key={e.name} className={cx('flex cursor-pointer gap-3 rounded-xl border px-3 py-2.5 transition', selected.includes(e.name) ? 'border-koraal bg-koraal/5' : 'border-line hover:bg-sunken/50')}>
                <input type="checkbox" className="mt-1 accent-[#FF6B57]" checked={selected.includes(e.name)} onChange={() => toggle(e.name)} />
                <span>
                  <span className="block font-mono text-xs font-semibold">{e.name}</span>
                  <span className="block text-xs text-muted">{e.label}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        {edit && <Switch checked={active} onChange={setActive} label={t('api.webhookActive')} description={!edit.active && edit.disabledReason ? t('api.webhookDisabledFailures') : undefined} />}
      </div>
    </Modal>
  );
}

function DeliveriesDialog({ hook, onClose }: { hook: Webhook | null; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['webhooks', hook?.id, 'deliveries'],
    enabled: Boolean(hook),
    queryFn: () => api.get<{ deliveries: Delivery[] }>(`/webhooks/${hook!.id}/deliveries`),
  });
  const retry = useMutation({
    mutationFn: (d: Delivery) => api.post<{ delivery: Delivery }>(`/webhooks/${hook!.id}/deliveries/${d.id}/retry`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['webhooks'] });
      if (r.delivery?.status === 'success') toast.success(t('api.deliveryOk'));
      else toast.error(errorText(r.delivery?.error ?? null) ?? t('api.deliveryFailed'));
    },
  });
  const tones = { pending: 'warning', success: 'online', failed: 'offline' } as const;
  return (
    <Modal
      open={Boolean(hook)}
      onClose={onClose}
      wide
      title={t('api.deliveries')}
      description={hook?.url}
      footer={
        <Button variant="secondary" icon={<RefreshCw className="size-4" />} loading={isFetching} onClick={() => refetch()}>
          {t('api.refresh')}
        </Button>
      }
    >
      {isLoading || !data ? (
        <Spinner />
      ) : !data.deliveries.length ? (
        <p className="text-sm text-muted">{t('api.noDeliveries')}</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {data.deliveries.map((d) => (
            <li key={d.id} className="text-sm">
              <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-sunken/50" onClick={() => setOpen(open === d.id ? null : d.id)}>
                <Badge tone={tones[d.status]}>{t(`api.deliveryStatus.${d.status}`)}</Badge>
                <span className="flex-1 truncate font-mono text-xs">{d.event}</span>
                <span className="hidden text-xs text-muted sm:inline">{d.responseStatus ? `HTTP ${d.responseStatus}` : (errorText(d.error) ?? '')}</span>
                <span className="text-xs whitespace-nowrap text-muted">{timeAgo(d.createdAt)}</span>
                <ChevronDown className={cx('size-4 text-muted transition', open === d.id && 'rotate-180')} />
              </button>
              {open === d.id && (
                <div className="space-y-3 border-t border-line bg-surface/50 px-4 py-3">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    <dt className="text-muted">{t('api.attempts')}</dt>
                    <dd>{d.attempts}</dd>
                    <dt className="text-muted">{t('api.duration')}</dt>
                    <dd>{d.durationMs ?? '—'} ms</dd>
                    {d.nextAttemptAt && (
                      <>
                        <dt className="text-muted">{t('api.nextAttempt')}</dt>
                        <dd>{formatDate(d.nextAttemptAt)}</dd>
                      </>
                    )}
                    {d.error && (
                      <>
                        <dt className="text-muted">{t('api.error')}</dt>
                        <dd className="col-span-1 text-offline sm:col-span-3">{errorText(d.error)}</dd>
                      </>
                    )}
                  </dl>
                  <pre className="max-h-60 overflow-auto rounded-lg bg-nacht p-3 font-mono text-[11px] text-white/90">{JSON.stringify({ id: d.id, ...d.payload }, null, 2)}</pre>
                  {d.responseBody && <pre className="max-h-32 overflow-auto rounded-lg bg-sunken p-3 font-mono text-[11px]">{d.responseBody}</pre>}
                  {d.status !== 'pending' && (
                    <Button size="sm" variant="secondary" icon={<RotateCw className="size-4" />} loading={retry.isPending} onClick={() => retry.mutate(d)}>
                      {t('api.retry')}
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function Webhooks() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const [confirmDialog, ask] = useConfirm();
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => api.get<KeysResponse>('/api-keys') });
  const { data, isLoading } = useQuery({ queryKey: ['webhooks'], queryFn: () => api.get<{ webhooks: Webhook[]; events: { name: string; label: string }[] }>('/webhooks') });
  const [dialog, setDialog] = useState<{ edit: Webhook | null } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Webhook | null>(null);
  const audience = keys.data?.audience ?? 'tenant';
  const test = useMutation({
    mutationFn: (w: Webhook) => api.post<{ delivery: Delivery }>(`/webhooks/${w.id}/test`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['webhooks'] });
      if (r.delivery?.status === 'success') toast.success(t('api.testOk', { status: r.delivery.responseStatus }));
      else toast.error(t('api.testFailed', { error: errorText(r.delivery?.error ?? null) ?? '?' }));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const reveal = useMutation({ mutationFn: (w: Webhook) => api.get<{ secret: string }>(`/webhooks/${w.id}/secret`), onSuccess: (r) => setSecret(r.secret) });
  const rotate = useMutation({
    mutationFn: (w: Webhook) => api.post<{ secret: string }>(`/webhooks/${w.id}/secret`),
    onSuccess: (r) => {
      setSecret(r.secret);
      toast.success(t('api.secretRotated'));
    },
  });
  const remove = useMutation({
    mutationFn: (w: Webhook) => api.del(`/webhooks/${w.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webhooks'] });
      toast.success(t('api.webhookDeleted'));
    },
  });
  if (isLoading || !data) return <Spinner />;
  return (
    <>
      <Card>
        <CardHeader
          title={t('api.webhooks')}
          description={t(audience === 'platform' ? 'api.webhookIntroPlatform' : 'api.webhookIntroTenant')}
          action={
            <Button variant="accent" size="sm" icon={<Plus className="size-4" />} onClick={() => setDialog({ edit: null })}>
              {t('api.newWebhook')}
            </Button>
          }
        />
        {!data.webhooks.length ? (
          <EmptyState icon={<WebhookIcon className="size-6" />} title={t('api.noWebhooks')} description={t('api.noWebhooksHint')} />
        ) : (
          <ul className="divide-y divide-line">
            {data.webhooks.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge tone={!w.active ? 'offline' : w.failures > 0 ? 'warning' : 'online'}>{!w.active ? t('api.webhookOff') : w.failures > 0 ? t('api.webhookFailing', { count: w.failures }) : t('common.active')}</Badge>
                    <p className="truncate font-mono text-sm">{w.url}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {w.description ? `${w.description} · ` : ''}
                    {t('api.eventCount', { count: w.events.length })} · {w.lastDeliveryAt ? t('api.lastDelivery', { when: timeAgo(w.lastDeliveryAt) }) : t('api.noDeliveriesYet')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button variant="secondary" size="sm" icon={<Send className="size-4" />} loading={test.isPending && test.variables?.id === w.id} onClick={() => test.mutate(w)}>
                    {t('api.test')}
                  </Button>
                  <Button variant="ghost" size="sm" title={t('api.deliveries')} aria-label={t('api.deliveries')} onClick={() => setDeliveries(w)}>
                    <History className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" title={t('api.showSecret')} aria-label={t('api.showSecret')} onClick={() => reveal.mutate(w)}>
                    <Eye className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" title={t('api.rotateSecret')} aria-label={t('api.rotateSecret')} onClick={async () => (await ask(t('api.confirmRotate'))) && rotate.mutate(w)}>
                    <RotateCw className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" title={t('common.edit')} aria-label={t('common.edit')} onClick={() => setDialog({ edit: w })}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" title={t('common.delete')} aria-label={t('common.delete')} onClick={async () => (await ask(t('api.confirmDeleteWebhook', { url: w.url }))) && remove.mutate(w)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {dialog && <WebhookDialog edit={dialog.edit} events={data.events} audience={audience} onClose={() => setDialog(null)} onCreated={setSecret} />}
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
      <DeliveriesDialog hook={deliveries} onClose={() => setDeliveries(null)} />
      {confirmDialog}
    </>
  );
}

// ── Documentation and explorer ───────────────────────────────────────────────

type Schema = { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; default?: unknown; enum?: unknown[]; items?: Schema; anyOf?: Schema[]; allOf?: Schema[]; const?: unknown };
type Param = { name: string; in: 'path' | 'query'; required: boolean; description: string; schema: { type: string; enum?: string[] } };
type Op = { operationId: string; tags: string[]; summary: string; description: string; 'x-scope': string; parameters: Param[]; requestBody?: { content: { 'application/json': { schema: Schema } } } };
type Spec = { info: { title: string; version: string; description: string }; tags: { name: string; description: string }[]; paths: Record<string, Record<string, Op>>; webhooks: Record<string, { post: { summary: string } }> };

/** A small example body from a JSON schema: required fields and fields with a default. */
function example(s: Schema | undefined, depth = 0): unknown {
  if (!s || depth > 4) return null;
  if (s.default !== undefined) return s.default;
  if (s.const !== undefined) return s.const;
  if (s.enum?.length) return s.enum[0];
  if (s.allOf) return Object.assign({}, ...s.allOf.map((x) => example(x, depth + 1) as object));
  if (s.anyOf) return example(s.anyOf.find((x) => x.type !== 'null') ?? s.anyOf[0], depth + 1);
  const type = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type;
  if (type === 'object' || s.properties) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.properties ?? {})) if (s.required?.includes(k) || v.default !== undefined) out[k] = example(v, depth + 1);
    return out;
  }
  if (type === 'array') return [];
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  return '';
}

function Operation({ path, method, op, baseOrigin }: { path: string; method: string; op: Op; baseOrigin: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(() => sessionToken.value);
  const [values, setValues] = useState<Record<string, string>>({});
  const schema = op.requestBody?.content['application/json'].schema;
  const [body, setBody] = useState(() => (schema ? JSON.stringify(example(schema), null, 2) : ''));
  const [result, setResult] = useState<{ status: number; text: string; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const M = method.toUpperCase();
  const url = () => {
    let p = path;
    const q = new URLSearchParams();
    for (const prm of op.parameters) {
      const v = values[prm.name] ?? '';
      if (prm.in === 'path') p = p.replace(`{${prm.name}}`, encodeURIComponent(v));
      else if (v) q.set(prm.name, v);
    }
    return `${p}${q.size ? `?${q}` : ''}`;
  };
  const send = async () => {
    sessionToken.value = token;
    setBusy(true);
    const started = performance.now();
    try {
      const res = await fetch(url(), {
        method: M,
        credentials: 'omit',
        headers: { authorization: `Bearer ${token.trim()}`, 'x-locale': currentLocale(), ...(schema ? { 'content-type': 'application/json' } : {}) },
        body: schema ? body : undefined,
      });
      const type = res.headers.get('content-type') ?? '';
      let text = type.includes('json') ? JSON.stringify(await res.json(), null, 2) : `(${type || '—'}, ${(await res.blob()).size} bytes)`;
      if (text.length > 20000) text = `${text.slice(0, 20000)}\n…`;
      setResult({ status: res.status, text, ms: Math.round(performance.now() - started) });
    } catch (e) {
      setResult({ status: 0, text: (e as Error).message, ms: 0 });
    } finally {
      setBusy(false);
    }
  };
  const curl = [`curl -X ${M} '${baseOrigin}${url()}'`, `  -H 'Authorization: Bearer ${token.trim() || '<key>'}'`, ...(schema ? [`  -H 'Content-Type: application/json'`, `  -d '${body.replace(/\s*\n\s*/g, ' ')}'`] : [])].join(' \\\n');
  return (
    <li>
      <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-sunken/50" onClick={() => setOpen(!open)} aria-expanded={open}>
        <MethodBadge method={M} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-xs sm:text-sm">{path}</span>
          <span className="block truncate text-xs text-muted">{op.summary}</span>
        </span>
        <span className="hidden rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-muted md:inline">{op['x-scope']}</span>
        <ChevronDown className={cx('size-4 shrink-0 text-muted transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-line bg-surface/50 px-4 py-4">
          <p className="text-sm whitespace-pre-line text-muted">{op.description.replace(/`/g, '')}</p>
          <Field label={t('api.explorerKey')} htmlFor={`tk-${op.operationId}`} hint={t('api.explorerKeyHint')}>
            <Input id={`tk-${op.operationId}`} type="password" autoComplete="off" placeholder="cpk_…" value={token} onChange={(e) => setToken(e.target.value)} />
          </Field>
          {op.parameters.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {op.parameters.map((p) => (
                <Field key={p.name} label={`${p.name}${p.required ? ' *' : ''}`} htmlFor={`p-${op.operationId}-${p.name}`} hint={p.description}>
                  {p.schema.enum ? (
                    <Select id={`p-${op.operationId}-${p.name}`} value={values[p.name] ?? ''} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}>
                      <option value="" />
                      {p.schema.enum.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </Select>
                  ) : (
                    <Input id={`p-${op.operationId}-${p.name}`} value={values[p.name] ?? ''} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })} />
                  )}
                </Field>
              ))}
            </div>
          )}
          {schema && (
            <details className="group">
              <summary className="cursor-pointer text-xs font-semibold text-muted">{t('api.bodySchema')}</summary>
              <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-sunken p-3 font-mono text-[11px]">{JSON.stringify(schema, null, 2)}</pre>
            </details>
          )}
          {schema && (
            <Field label={t('api.body')} htmlFor={`b-${op.operationId}`}>
              <Textarea id={`b-${op.operationId}`} rows={Math.min(14, body.split('\n').length + 1)} value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} />
            </Field>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="accent" size="sm" icon={<Play className="size-4" />} loading={busy} disabled={!token.trim()} onClick={send}>
              {t('api.send')}
            </Button>
            {M !== 'GET' && <span className="text-xs text-warning">{t('api.sendWarning')}</span>}
          </div>
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-muted">cURL</summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-nacht p-3 font-mono text-[11px] text-white/90">{curl}</pre>
          </details>
          {result && (
            <div>
              <p className="mb-1.5 flex items-center gap-2 text-xs text-muted">
                <Badge tone={result.status >= 200 && result.status < 300 ? 'online' : result.status < 500 && result.status > 0 ? 'warning' : 'offline'}>{result.status || '—'}</Badge>
                {result.ms} ms
              </p>
              <pre className="max-h-80 overflow-auto rounded-lg bg-nacht p-3 font-mono text-[11px] text-white/90">{result.text}</pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** The key typed in the explorer is kept for this page visit only, never stored. */
const sessionToken = { value: '' };

function Docs() {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['api-docs', i18n.resolvedLanguage], queryFn: () => api.get<{ audience: Audience; spec: Spec }>('/api-docs') });
  const groups = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.spec.tags
      .map((tag) => ({
        tag,
        ops: Object.entries(data.spec.paths).flatMap(([path, methods]) =>
          Object.entries(methods)
            .filter(([, op]) => op.tags.includes(tag.name) && (!q || path.toLowerCase().includes(q) || op.summary.toLowerCase().includes(q) || op['x-scope'].includes(q)))
            .map(([method, op]) => ({ path, method, op })),
        ),
      }))
      .filter((g) => g.ops.length);
  }, [data, search]);
  if (isLoading || !data) return <Spinner />;
  const origin = window.location.origin;
  const specUrl = (lang: string) => `/api/v1/openapi.json?audience=${data.audience}&lang=${lang}`;
  return (
    <>
      <Card className="mb-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 font-semibold">
              {data.spec.info.title} <Badge tone="info">v{data.spec.info.version}</Badge>
            </p>
            <div className="mt-2 space-y-2 text-sm text-muted">
              {data.spec.info.description.split('\n\n').map((p, i) => (
                <p key={i}>{p.replace(/\*\*/g, '').replace(/`/g, '')}</p>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={specUrl('en')} download={`openapi-${data.audience}-en.json`}>
              <Button variant="secondary" size="sm" icon={<Download className="size-4" />}>
                OpenAPI (EN)
              </Button>
            </a>
            <a href={specUrl('nl')} download={`openapi-${data.audience}-nl.json`}>
              <Button variant="secondary" size="sm" icon={<Download className="size-4" />}>
                OpenAPI (NL)
              </Button>
            </a>
          </div>
        </div>
      </Card>
      <div className="relative mb-4">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
        <Input className="pl-9" placeholder={t('api.searchOps')} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="space-y-4">
        {groups.map((g) => (
          <Card key={g.tag.name}>
            <div className="border-b border-line px-4 py-3">
              <p className="font-semibold">{g.tag.description}</p>
              <p className="font-mono text-xs text-muted">{g.tag.name}:read · {g.tag.name}:write</p>
            </div>
            <ul className="divide-y divide-line">
              {g.ops.map((o) => (
                <Operation key={`${o.method} ${o.path}`} {...o} baseOrigin={origin} />
              ))}
            </ul>
          </Card>
        ))}
        <Card>
          <CardHeader title={t('api.webhookEvents')} description={t('api.webhookEventsHint')} />
          <ul className="divide-y divide-line">
            {Object.entries(data.spec.webhooks).map(([name, w]) => (
              <li key={name} className="flex flex-wrap items-center gap-3 px-6 py-2.5 text-sm">
                <code className="font-mono text-xs font-semibold">{name}</code>
                <span className="text-muted">{w.post.summary}</span>
              </li>
            ))}
          </ul>
          <pre className="mx-6 mb-6 overflow-x-auto rounded-xl bg-nacht p-4 font-mono text-[11px] leading-relaxed text-white/90">{`POST <your address>
Content-Type: application/json
X-Webhook-Event: guest.authorized
X-Webhook-Timestamp: 1792540000
X-Webhook-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<body>")>

{ "id": "…", "event": "guest.authorized", "createdAt": "…", "tenantId": "…", "data": { … } }`}</pre>
        </Card>
      </div>
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function ApiPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'keys' | 'webhooks' | 'docs') ?? 'keys';
  const tabs: { id: typeof tab; label: string; icon: typeof KeyRound }[] = [
    { id: 'keys', label: t('api.tabKeys'), icon: KeyRound },
    { id: 'webhooks', label: t('api.tabWebhooks'), icon: WebhookIcon },
    { id: 'docs', label: t('api.tabDocs'), icon: BookOpen },
  ];
  let content: ReactNode = null;
  if (tab === 'keys') content = <Keys />;
  if (tab === 'webhooks') content = <Webhooks />;
  if (tab === 'docs') content = <Docs />;
  return (
    <>
      <PageHeader eyebrow={t('api.eyebrow')} title={t('api.title')} description={t('api.description')} />
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-sunken p-1 sm:w-fit" role="tablist">
        {tabs.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setParams({ tab: x.id }, { replace: true })}
            className={cx('flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium whitespace-nowrap transition sm:flex-none', tab === x.id ? 'bg-raised shadow-card' : 'text-muted hover:text-ink')}
          >
            <x.icon className="hidden size-4 sm:block" />
            {x.label}
          </button>
        ))}
      </div>
      {content}
    </>
  );
}
