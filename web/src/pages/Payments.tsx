import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, CreditCard, Package as PackageIcon, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Copyable, Segmented, Slider, useConfirm } from '../components/controls';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Switch, cx } from '../components/ui';
import i18n, { languages } from '../i18n';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { useTenantScope } from '../lib/tenant';
import { duration } from './Vouchers';

type Settings = {
  provider: 'none' | 'mollie' | 'stripe';
  currency: string;
  graceMinutes: number;
  mollieApiKeySet: boolean;
  stripeSecretKeySet: boolean;
  stripeWebhookSecretSet: boolean;
};
type Pkg = { id: string; name: Record<string, string>; priceCents: number; durationMinutes: number; dataLimitMb: number | null; downKbps: number | null; upKbps: number | null; active: boolean; sortOrder: number };
type Payment = { id: string; packageName: string; amountCents: number; currency: string; status: 'open' | 'paid' | 'failed' | 'canceled' | 'expired'; email: string | null; provider: string; providerRef: string | null; createdAt: string; paidAt: string | null };

const money = (cents: number, currency = 'EUR') => new Intl.NumberFormat(i18n.resolvedLanguage === 'nl' ? 'nl-NL' : 'en-GB', { style: 'currency', currency }).format(cents / 100);
const tones = { open: 'warning', paid: 'online', failed: 'offline', canceled: 'neutral', expired: 'neutral' } as const;
const pkgName = (p: Pkg) => p.name[i18n.resolvedLanguage ?? 'en'] || p.name.en || Object.values(p.name).find(Boolean) || '—';

const WALLED: Record<'mollie' | 'stripe', string[]> = {
  mollie: ['mollie.com', '*.mollie.com', '*.mollie.nl', 'ideal.nl', '*.ideal.nl'],
  stripe: ['stripe.com', '*.stripe.com', '*.stripe.network', 'stripecdn.com', '*.stripecdn.com'],
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

function Transactions() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({ queryKey: ['payments'], queryFn: () => api.get<{ payments: Payment[]; totals: { currency: string; paid: number; totalCents: number; monthCents: number }[] }>('/payments'), refetchInterval: 30_000 });
  if (isLoading) return <Spinner />;
  const totals = data?.totals ?? [];
  const sum = (k: 'totalCents' | 'monthCents') => (totals.length ? totals.map((x) => money(x[k], x.currency)).join(' + ') : money(0));
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Tile icon={<Wallet className="size-5" />} label={t('payments.total')} value={sum('totalCents')} />
        <Tile icon={<Wallet className="size-5" />} label={t('payments.month')} value={sum('monthCents')} />
        <Tile icon={<CheckCircle2 className="size-5" />} label={t('payments.count')} value={totals.reduce((s, x) => s + x.paid, 0)} />
      </div>
      <Card className="mt-6">
        {!data?.payments.length ? (
          <EmptyState icon={<CreditCard className="size-6" />} title={t('payments.empty')} description={t('payments.emptyHint')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-6 py-3 font-medium">{t('payments.colDate')}</th>
                  <th className="px-6 py-3 font-medium">{t('payments.colPackage')}</th>
                  <th className="px-6 py-3 font-medium">{t('payments.colAmount')}</th>
                  <th className="px-6 py-3 font-medium">{t('payments.colStatus')}</th>
                  <th className="hidden px-6 py-3 font-medium md:table-cell">{t('payments.colEmail')}</th>
                  <th className="hidden px-6 py-3 font-medium lg:table-cell">{t('payments.colRef')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.payments.map((p) => (
                  <tr key={p.id} className="transition hover:bg-sunken/50">
                    <td className="px-6 py-3 text-muted">{formatDate(p.paidAt ?? p.createdAt)}</td>
                    <td className="px-6 py-3">{p.packageName}</td>
                    <td className="px-6 py-3 font-semibold">{money(p.amountCents, p.currency)}</td>
                    <td className="px-6 py-3">
                      <Badge tone={tones[p.status]}>{t(`payments.status.${p.status}`)}</Badge>
                    </td>
                    <td className="hidden px-6 py-3 text-muted md:table-cell">{p.email ?? '—'}</td>
                    <td className="hidden px-6 py-3 font-mono text-xs text-muted lg:table-cell">
                      {p.provider} · {p.providerRef ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function PackageDialog({ pkg, open, onClose, currency }: { pkg: Pkg | null; open: boolean; onClose: () => void; currency: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const blank = { name: {} as Record<string, string>, price: '4.95', durationMinutes: 1440, dataLimitMb: '', downKbps: '', upKbps: '', active: true, sortOrder: 0 };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (!open) return;
    setF(
      pkg
        ? { name: pkg.name, price: (pkg.priceCents / 100).toFixed(2), durationMinutes: pkg.durationMinutes, dataLimitMb: pkg.dataLimitMb?.toString() ?? '', downKbps: pkg.downKbps?.toString() ?? '', upKbps: pkg.upKbps?.toString() ?? '', active: pkg.active, sortOrder: pkg.sortOrder }
        : blank,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pkg]);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name,
        priceCents: Math.round(Number(f.price.replace(',', '.')) * 100),
        durationMinutes: Number(f.durationMinutes),
        dataLimitMb: f.dataLimitMb ? Number(f.dataLimitMb) : null,
        downKbps: f.downKbps ? Number(f.downKbps) : null,
        upKbps: f.upKbps ? Number(f.upKbps) : null,
        active: f.active,
        sortOrder: Number(f.sortOrder),
      };
      return pkg ? api.put(`/payment-packages/${pkg.id}`, body) : api.post('/payment-packages', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-packages'] });
      toast.success(t('common.saved'));
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={pkg ? t('payments.editPackage') : t('payments.addPackage')}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="accent" loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {languages.map((l) => (
          <Field key={l.code} label={`${t('payments.name')} ${l.flag}`} htmlFor={`pk-${l.code}`}>
            <Input id={`pk-${l.code}`} maxLength={80} placeholder={l.code === 'nl' ? 'Dagpas' : 'Day pass'} value={f.name[l.code] ?? ''} onChange={(e) => setF({ ...f, name: { ...f.name, [l.code]: e.target.value } })} />
          </Field>
        ))}
        <Field label={`${t('payments.price')} (${currency})`} htmlFor="pk-price">
          <Input id="pk-price" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        </Field>
        <Field label={t('payments.duration')} htmlFor="pk-dur">
          <Select id="pk-dur" value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: Number(e.target.value) })}>
            {[60, 120, 240, 480, 1440, 2880, 4320, 10080, 43200].map((m) => (
              <option key={m} value={m}>
                {duration(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`${t('portalSettings.dataLimit')} (MB)`} htmlFor="pk-data">
          <Input id="pk-data" type="number" placeholder={t('portalSettings.unlimited')} value={f.dataLimitMb} onChange={(e) => setF({ ...f, dataLimitMb: e.target.value })} />
        </Field>
        <Field label={t('payments.order')} htmlFor="pk-order">
          <Input id="pk-order" type="number" min={0} value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} />
        </Field>
        <Field label={`${t('portalSettings.down')} (kbps)`} htmlFor="pk-down">
          <Input id="pk-down" type="number" placeholder={t('portalSettings.unlimited')} value={f.downKbps} onChange={(e) => setF({ ...f, downKbps: e.target.value })} />
        </Field>
        <Field label={`${t('portalSettings.up')} (kbps)`} htmlFor="pk-up">
          <Input id="pk-up" type="number" placeholder={t('portalSettings.unlimited')} value={f.upKbps} onChange={(e) => setF({ ...f, upKbps: e.target.value })} />
        </Field>
      </div>
      <div className="mt-5">
        <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label={t('payments.active')} description={t('payments.activeHint')} />
      </div>
    </Modal>
  );
}

function Packages({ currency, canManage }: { currency: string; canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [confirmDialog, ask] = useConfirm();
  const [editing, setEditing] = useState<Pkg | null>(null);
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['payment-packages'], queryFn: () => api.get<{ packages: Pkg[] }>('/payment-packages') });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/payment-packages/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payment-packages'] }),
  });
  return (
    <Card>
      <CardHeader
        title={t('payments.packages')}
        description={t('payments.packagesHint')}
        action={
          canManage && (
            <Button size="sm" variant="accent" icon={<Plus className="size-4" />} onClick={() => (setEditing(null), setOpen(true))}>
              {t('payments.addPackage')}
            </Button>
          )
        }
      />
      {isLoading ? (
        <div className="p-6">
          <Spinner />
        </div>
      ) : !data?.packages.length ? (
        <EmptyState icon={<PackageIcon className="size-6" />} title={t('payments.noPackages')} description={t('payments.noPackagesHint')} />
      ) : (
        <ul className="divide-y divide-line">
          {data.packages.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
              <span className="grid size-10 place-items-center rounded-xl bg-koraal/12 text-accent">
                <PackageIcon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {pkgName(p)} {!p.active && <Badge>{t('common.inactive')}</Badge>}
                </p>
                <p className="text-sm text-muted">
                  {duration(p.durationMinutes)}
                  {p.dataLimitMb ? ` · ${p.dataLimitMb} MB` : ''}
                  {p.downKbps ? ` · ↓ ${p.downKbps} kbps` : ''}
                </p>
              </div>
              <p className="display text-xl">{money(p.priceCents, currency)}</p>
              {canManage && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" aria-label={t('common.edit')} onClick={() => (setEditing(p), setOpen(true))}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={t('common.delete')} onClick={async () => (await ask(t('payments.confirmDeletePackage', { name: pkgName(p) }))) && remove.mutate(p.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <PackageDialog pkg={editing} open={open} onClose={() => setOpen(false)} currency={currency} />
      {confirmDialog}
    </Card>
  );
}

function ProviderSettings({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['payment-settings'], queryFn: () => api.get<{ settings: Settings; stripeWebhookUrl: string; mollieWebhookUrl: string }>('/payment-settings') });
  const [form, setForm] = useState<Settings | null>(null);
  const [keys, setKeys] = useState({ mollieApiKey: '', stripeSecretKey: '', stripeWebhookSecret: '' });
  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);
  const save = useMutation({
    mutationFn: () => api.put<{ settings: Settings }>('/payment-settings', { provider: form!.provider, currency: form!.currency, graceMinutes: form!.graceMinutes, ...keys }),
    onSuccess: () => {
      setKeys({ mollieApiKey: '', stripeSecretKey: '', stripeWebhookSecret: '' });
      qc.invalidateQueries({ queryKey: ['payment-settings'] });
      toast.success(t('common.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; mode: 'test' | 'live' }>('/payment-settings/test', { provider: form!.provider, ...keys }),
    onSuccess: (d) => toast.success(t('payments.testOk', { mode: t(`payments.testMode.${d.mode}`) })),
    onError: (e: Error) => toast.error(e.message),
  });
  if (!form || !data) return <Spinner />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm({ ...form, [k]: v });
  const providers = [
    { id: 'none', title: t('payments.providerNone'), hint: t('payments.providerNoneHint') },
    { id: 'mollie', title: 'Mollie', hint: t('payments.mollieHint') },
    { id: 'stripe', title: 'Stripe', hint: t('payments.stripeHint') },
  ] as const;
  const grace = form.graceMinutes;
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <Card>
          <CardHeader title={t('payments.provider')} />
          <div className="space-y-5 p-6">
            <div className="grid gap-3 sm:grid-cols-3">
              {providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => set('provider', p.id)}
                  className={cx('rounded-2xl border p-4 text-left transition', form.provider === p.id ? 'border-koraal bg-koraal/5 shadow-card' : 'border-line hover:border-muted')}
                >
                  <p className="font-semibold">{p.title}</p>
                  <p className="mt-1 text-xs text-muted">{p.hint}</p>
                </button>
              ))}
            </div>
            {form.provider === 'mollie' && (
              <>
                <Field label={t('payments.mollieKey')} htmlFor="pm-key" hint={t('payments.mollieKeyHint')}>
                  <Input id="pm-key" type="password" autoComplete="off" placeholder={data.settings.mollieApiKeySet ? `•••••• (${t('payments.keySet')})` : 'live_…'} value={keys.mollieApiKey} onChange={(e) => setKeys({ ...keys, mollieApiKey: e.target.value })} />
                </Field>
                <div className="space-y-1.5 text-xs text-muted">
                  <p>{t('payments.mollieWebhook')}</p>
                  <Copyable value={data.mollieWebhookUrl} />
                </div>
              </>
            )}
            {form.provider === 'stripe' && (
              <>
                <Field label={t('payments.stripeKey')} htmlFor="ps-key" hint={t('payments.stripeKeyHint')}>
                  <Input id="ps-key" type="password" autoComplete="off" placeholder={data.settings.stripeSecretKeySet ? `•••••• (${t('payments.keySet')})` : 'sk_live_…'} value={keys.stripeSecretKey} onChange={(e) => setKeys({ ...keys, stripeSecretKey: e.target.value })} />
                </Field>
                <Field label={t('payments.stripeWebhook')} htmlFor="ps-wh" hint={<span className="block space-y-1.5"><span className="block">{t('payments.stripeWebhookHint')}</span><Copyable value={data.stripeWebhookUrl} /></span>}>
                  <Input id="ps-wh" type="password" autoComplete="off" placeholder={data.settings.stripeWebhookSecretSet ? `•••••• (${t('payments.keySet')})` : 'whsec_…'} value={keys.stripeWebhookSecret} onChange={(e) => setKeys({ ...keys, stripeWebhookSecret: e.target.value })} />
                </Field>
              </>
            )}
            {form.provider !== 'none' && (
              <Field label={t('payments.currency')} htmlFor="p-cur">
                <Select id="p-cur" value={form.currency} onChange={(e) => set('currency', e.target.value)} className="sm:w-48">
                  {['EUR', 'USD', 'GBP', 'CHF'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          {canManage && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">
              {form.provider !== 'none' && (
                <Button variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>
                  {t('payments.test')}
                </Button>
              )}
              <Button variant="accent" loading={save.isPending} onClick={() => save.mutate()}>
                {t('common.save')}
              </Button>
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title={t('payments.graceTitle')} />
          <div className="space-y-5 p-6">
            <p className="text-sm text-muted">{t('payments.graceExplain')}</p>
            <ol className="space-y-3">
              {[t('payments.graceStep1'), grace > 0 ? t('payments.graceStep2', { minutes: grace }) : t('payments.graceStep3None'), t('payments.graceStep3')].map((s, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className={cx('grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold', i === 1 ? 'bg-koraal text-nacht' : 'bg-sunken text-muted')}>{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            <Segmented
              value={String([0, 5, 10, 15, 20].includes(grace) ? grace : -1)}
              onChange={(v) => v !== '-1' && set('graceMinutes', Number(v))}
              options={[0, 5, 10, 15, 20].map((m) => ({ value: String(m), label: m ? `${m}` : t('payments.graceOff') }))}
              label={t('payments.grace')}
            />
            <Slider label={t('payments.grace')} value={grace} min={0} max={30} unit={` ${t('payments.minutes')}`} onChange={(v) => set('graceMinutes', v)} />
            <p className="flex gap-2 rounded-lg bg-sunken px-3 py-2 text-xs text-muted">
              <Clock className="mt-0.5 size-3.5 shrink-0" />
              {t('payments.graceAdvice')}
            </p>
          </div>
        </Card>
        {form.provider !== 'none' && (
          <Card className="p-6">
            <p className="text-sm font-semibold">{t('payments.walledTitle')}</p>
            <p className="mt-1 text-xs text-muted">{t('payments.walledText')}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {WALLED[form.provider].map((h) => (
                <code key={h} className="rounded-md bg-sunken px-2 py-1 font-mono text-[11px]">
                  {h}
                </code>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

export function PaymentsPage() {
  const { t } = useTranslation();
  const scope = useTenantScope();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'overview' | 'packages' | 'settings') ?? 'overview';
  const settings = useQuery({ queryKey: ['payment-settings'], queryFn: () => api.get<{ settings: Settings }>('/payment-settings') });
  const currency = settings.data?.settings.currency ?? 'EUR';
  const tabs = [
    { id: 'overview', label: t('payments.tabOverview') },
    { id: 'packages', label: t('payments.tabPackages') },
    { id: 'settings', label: t('payments.tabSettings') },
  ] as const;
  return (
    <>
      <PageHeader eyebrow={t('nav.portals')} title={t('payments.title')} description={t('payments.description')} />
      {settings.data?.settings.provider === 'none' && <p className="mb-6 rounded-xl border border-line bg-raised px-4 py-3 text-sm text-muted">{t('payments.notConfigured')}</p>}
      <div className="mb-6 flex gap-1 rounded-xl bg-sunken p-1 sm:w-fit" role="tablist">
        {tabs.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setParams({ tab: x.id }, { replace: true })}
            className={cx('flex-1 rounded-lg px-4 py-1.5 text-sm font-medium transition sm:flex-none', tab === x.id ? 'bg-raised shadow-card' : 'text-muted hover:text-ink')}
          >
            {x.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Transactions />}
      {tab === 'packages' && <Packages currency={currency} canManage={scope.canManage} />}
      {tab === 'settings' && <ProviderSettings canManage={scope.canManage} />}
    </>
  );
}
