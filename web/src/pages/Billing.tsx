import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Ban,
  Building2,
  CalendarClock,
  CheckCircle2,
  Copy,
  FileText,
  Layers,
  Pencil,
  Plus,
  Receipt,
  Repeat,
  Send,
  Stamp,
  Trash2,
  Wallet,
  BellRing,
  PlayCircle,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Copyable, ImageUpload, Segmented, useConfirm } from '../components/controls';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Switch, Textarea, cx } from '../components/ui';
import { api } from '../lib/api';
import { centsInput, formatDay, formatMoney, parseMoney } from '../lib/format';

// ── Types ────────────────────────────────────────────────────────────────────

type Interval = 'month' | 'quarter' | 'year';
type Party = { name: string; address: string; email: string; vatNumber: string; reference?: string };
type Line = { description: string; quantity: number; unitCents: number };
export type Invoice = {
  id: string;
  tenantId: string | null;
  number: string | null;
  status: 'draft' | 'open' | 'paid' | 'void';
  source: 'subscription' | 'manual';
  locale: string;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  customer: Party;
  lines: Line[];
  vatRateBp: number;
  reverseCharge: boolean;
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  notes: string;
  sentAt: string | null;
  remindersSent: number;
  paidAt: string | null;
  paidVia: 'online' | 'manual' | null;
  overdue: boolean;
  payUrl: string | null;
};
type Plan = { id: string; name: string; description: string; priceCents: number; interval: Interval; active: boolean };
type Profile = {
  tenantId: string;
  companyName: string;
  address: string;
  email: string;
  vatNumber: string;
  reference: string;
  locale: 'en' | 'nl';
  vatRateBp: number;
  reverseCharge: boolean;
  subscriptionActive: boolean;
  planId: string | null;
  planName: string;
  priceCents: number;
  interval: Interval;
  startDate: string | null;
  nextInvoiceDate: string | null;
  autoSuspend: boolean;
};
type Customer = {
  tenant: { id: string; name: string; slug: string; contactEmail: string | null; status: 'active' | 'suspended'; billingSuspendedAt: string | null };
  profile: Profile | null;
  openCents: number;
  overdueCents: number;
};
type Totals = { openCents: number; overdueCents: number; overdueCount: number; paidMonthCents: number; drafts: number; mrrCents: number; subscriptions: number };
type BillingSettings = {
  companyName: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  vatNumber: string;
  cocNumber: string;
  iban: string;
  bic: string;
  logo: string | null;
  currency: string;
  defaultVatRateBp: number;
  paymentTermDays: number;
  numberPrefix: string;
  numberDigits: number;
  footer: string;
  autoSend: boolean;
  provider: 'none' | 'mollie' | 'stripe';
  mollieApiKeySet: boolean;
  stripeSecretKeySet: boolean;
  stripeWebhookSecretSet: boolean;
  reminders: boolean;
  reminderDays: number[];
  autoSuspend: boolean;
  suspendAfterDays: number;
};

const VAT_RATES = [2100, 900, 0];
const today = () => new Date().toISOString().slice(0, 10);
const rateLabel = (bp: number) => `${bp / 100}%`;

function useBillingSettings() {
  return useQuery({ queryKey: ['settings', 'billing'], queryFn: () => api.get<BillingSettings>('/settings/billing') });
}

export function InvoiceStatus({ invoice }: { invoice: Pick<Invoice, 'status' | 'overdue'> }) {
  const { t } = useTranslation();
  if (invoice.status === 'open' && invoice.overdue) return <Badge tone="offline">{t('billing.status.overdue')}</Badge>;
  const tone = { draft: 'neutral', open: 'warning', paid: 'online', void: 'neutral' } as const;
  return <Badge tone={tone[invoice.status]}>{t(`billing.status.${invoice.status}`)}</Badge>;
}

function Tile({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: ReactNode; hint?: string; tone?: 'danger' }) {
  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <span className={cx('grid size-10 place-items-center rounded-xl', tone === 'danger' ? 'bg-offline/12 text-offline' : 'bg-koraal/12 text-accent')}>{icon}</span>
      <p className="display mt-4 truncate text-xl sm:text-3xl">{value}</p>
      <p className="text-sm text-muted">{label}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

// ── Invoices ─────────────────────────────────────────────────────────────────

function InvoiceDialog({ invoice, customers, currency, defaultTenant, onClose }: { invoice: Invoice | null; customers: Customer[]; currency: string; defaultTenant?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tenantId, setTenantId] = useState(invoice?.tenantId ?? defaultTenant ?? customers[0]?.tenant.id ?? '');
  const profile = customers.find((c) => c.tenant.id === tenantId)?.profile;
  const [lines, setLines] = useState(() => (invoice?.lines ?? [{ description: '', quantity: 1, unitCents: 0 }]).map((l) => ({ description: l.description, quantity: String(l.quantity), price: centsInput(l.unitCents) })));
  const [notes, setNotes] = useState(invoice?.notes ?? '');
  const [vat, setVat] = useState<number | null>(invoice ? invoice.vatRateBp : null);
  const [reverse, setReverse] = useState<boolean | null>(invoice ? invoice.reverseCharge : null);
  const vatRate = vat ?? profile?.vatRateBp ?? 2100;
  const reverseCharge = reverse ?? profile?.reverseCharge ?? false;
  const parsed = lines.map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity.replace(',', '.')) || 0, unitCents: parseMoney(l.price) || 0 }));
  const subtotal = parsed.reduce((s, l) => s + Math.round(l.quantity * l.unitCents), 0);
  const vatCents = reverseCharge ? 0 : Math.round((subtotal * vatRate) / 10_000);

  const save = useMutation({
    mutationFn: async (issue: boolean) => {
      const body = { lines: parsed.filter((l) => l.description), notes, vatRateBp: vatRate, reverseCharge };
      const saved = invoice
        ? await api.put<{ invoice: Invoice }>(`/billing/invoices/${invoice.id}`, body)
        : await api.post<{ invoice: Invoice }>('/billing/invoices', { ...body, tenantId });
      if (!issue) return { issued: false as const };
      const r = await api.post<{ invoice: Invoice; sent: boolean; error?: string }>(`/billing/invoices/${saved.invoice.id}/issue`, { send: true });
      return { issued: true as const, ...r };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['billing'] });
      if (!r.issued) toast.success(t('billing.draftSaved'));
      else if (r.sent) toast.success(t('billing.issuedSent', { number: r.invoice.number }));
      else toast.warning(t('billing.issuedNotSent', { number: r.invoice.number, error: r.error ?? '' }));
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={invoice ? t('billing.editInvoice') : t('billing.newInvoice')}
      description={t('billing.invoiceFormHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="secondary" loading={save.isPending && save.variables === false} disabled={!tenantId} onClick={() => save.mutate(false)}>
            {t('billing.saveDraft')}
          </Button>
          <Button variant="accent" icon={<Send className="size-4" />} loading={save.isPending && save.variables === true} disabled={!tenantId || subtotal <= 0} onClick={() => save.mutate(true)}>
            {t('billing.issueAndSend')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label={t('billing.customer')} htmlFor="inv-tenant">
          <Select id="inv-tenant" value={tenantId} disabled={Boolean(invoice)} onChange={(e) => setTenantId(e.target.value)}>
            {customers.map((c) => (
              <option key={c.tenant.id} value={c.tenant.id}>
                {c.profile?.companyName || c.tenant.name}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <p className="mb-2 text-sm font-medium">{t('billing.lines')}</p>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_72px_110px_36px] gap-2">
                <Input aria-label={t('billing.lineDescription')} placeholder={t('billing.lineDescription')} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                <Input aria-label={t('billing.lineQuantity')} inputMode="decimal" className="text-right" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                <Input aria-label={`${t('billing.linePrice')} (${currency})`} inputMode="decimal" className="text-right" value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} />
                <Button variant="ghost" size="sm" className="h-10" aria-label={t('common.delete')} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-[1fr_72px_110px_36px] gap-2 px-1 text-[11px] text-muted">
            <span>{t('billing.lineDescription')}</span>
            <span className="text-right">{t('billing.lineQuantity')}</span>
            <span className="text-right">{t('billing.linePrice')}</span>
          </div>
          <Button variant="ghost" size="sm" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setLines([...lines, { description: '', quantity: '1', price: '0.00' }])}>
            {t('billing.addLine')}
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('billing.vatRate')} htmlFor="inv-vat">
            <Select id="inv-vat" value={vatRate} disabled={reverseCharge} onChange={(e) => setVat(Number(e.target.value))}>
              {[...new Set([...VAT_RATES, vatRate])].map((r) => (
                <option key={r} value={r}>
                  {rateLabel(r)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="pt-6">
            <Switch checked={reverseCharge} onChange={setReverse} label={t('billing.reverseCharge')} description={t('billing.reverseChargeHint')} />
          </div>
        </div>
        <Field label={t('billing.notes')} htmlFor="inv-notes" hint={t('billing.notesHint')}>
          <Textarea id="inv-notes" rows={2} className="font-sans text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="ml-auto max-w-xs space-y-1 rounded-xl bg-sunken p-4 text-sm">
          <p className="flex justify-between">
            <span className="text-muted">{t('billing.subtotal')}</span>
            <span>{formatMoney(subtotal, currency)}</span>
          </p>
          <p className="flex justify-between">
            <span className="text-muted">{reverseCharge ? t('billing.reverseCharge') : `${t('billing.vat')} ${rateLabel(vatRate)}`}</span>
            <span>{formatMoney(vatCents, currency)}</span>
          </p>
          <p className="flex justify-between border-t border-line pt-1 font-semibold">
            <span>{t('billing.total')}</span>
            <span>{formatMoney(subtotal + vatCents, currency)}</span>
          </p>
        </div>
      </div>
    </Modal>
  );
}

function PaidDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [notify, setNotify] = useState(true);
  const paid = useMutation({
    mutationFn: () => api.post(`/billing/invoices/${invoice.id}/mark-paid`, { notify }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing'] });
      toast.success(t('billing.markedPaid'));
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t('billing.markPaidTitle', { number: invoice.number })}
      description={t('billing.markPaidHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="accent" loading={paid.isPending} onClick={() => paid.mutate()}>
            {t('billing.markPaid')}
          </Button>
        </>
      }
    >
      <Switch checked={notify} onChange={setNotify} label={t('billing.sendConfirmation')} description={t('billing.sendConfirmationHint')} />
    </Modal>
  );
}

function Invoices({ customers, currency }: { customers: Customer[]; currency: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tenantFilter = params.get('tenant') ?? '';
  const [filter, setFilter] = useState<'all' | 'draft' | 'open' | 'overdue' | 'paid'>('all');
  const [editing, setEditing] = useState<Invoice | 'new' | null>(null);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [confirmDialog, ask] = useConfirm();
  const { data, isLoading } = useQuery({
    queryKey: ['billing', 'invoices', tenantFilter],
    queryFn: () => api.get<{ invoices: Invoice[]; totals: Totals }>(`/billing/invoices${tenantFilter ? `?tenant=${tenantFilter}` : ''}`),
  });
  const act = useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: 'issue' | 'delete' | 'send' | 'void'; body?: unknown }) =>
      action === 'delete' ? api.del(`/billing/invoices/${id}`) : api.post<{ invoice: Invoice; sent?: boolean; error?: string }>(`/billing/invoices/${id}/${action}`, body ?? {}),
    onSuccess: (r, v) => {
      qc.invalidateQueries({ queryKey: ['billing'] });
      const res = r as { sent?: boolean; error?: string; invoice?: Invoice } | undefined;
      if (v.action === 'issue' && res?.sent === false) toast.warning(t('billing.issuedNotSent', { number: res.invoice?.number, error: res.error ?? '' }));
      else toast.success(t(`billing.done.${v.action}`));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const names = new Map(customers.map((c) => [c.tenant.id, c.profile?.companyName || c.tenant.name]));
  const totals = data?.totals;
  const rows = (data?.invoices ?? []).filter((i) => (filter === 'all' ? true : filter === 'overdue' ? i.status === 'open' && i.overdue : i.status === filter));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Tile icon={<Wallet className="size-5" />} label={t('billing.tileOpen')} value={formatMoney(totals?.openCents ?? 0, currency)} />
        <Tile icon={<AlertTriangle className="size-5" />} tone={totals?.overdueCount ? 'danger' : undefined} label={t('billing.tileOverdue')} value={formatMoney(totals?.overdueCents ?? 0, currency)} hint={t('billing.tileOverdueCount', { count: totals?.overdueCount ?? 0 })} />
        <Tile icon={<CheckCircle2 className="size-5" />} label={t('billing.tilePaidMonth')} value={formatMoney(totals?.paidMonthCents ?? 0, currency)} />
        <Tile icon={<Repeat className="size-5" />} label={t('billing.tileMrr')} value={formatMoney(totals?.mrrCents ?? 0, currency)} hint={t('billing.tileSubscriptions', { count: totals?.subscriptions ?? 0 })} />
      </div>

      <Card className="mt-6">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="w-full max-w-full overflow-x-auto sm:w-auto">
            <Segmented
              value={filter}
              onChange={setFilter}
              label={t('billing.filter')}
              options={(['all', 'draft', 'open', 'overdue', 'paid'] as const).map((f) => ({ value: f, label: t(`billing.filters.${f}`) }))}
            />
          </div>
          <Select aria-label={t('billing.customer')} className="sm:w-56" value={tenantFilter} onChange={(e) => setParams(e.target.value ? { tab: 'invoices', tenant: e.target.value } : { tab: 'invoices' }, { replace: true })}>
            <option value="">{t('billing.allCustomers')}</option>
            {customers.map((c) => (
              <option key={c.tenant.id} value={c.tenant.id}>
                {c.profile?.companyName || c.tenant.name}
              </option>
            ))}
          </Select>
          <Button variant="accent" className="sm:ml-auto" icon={<Plus className="size-4" />} disabled={!customers.length} onClick={() => setEditing('new')}>
            {t('billing.newInvoice')}
          </Button>
        </div>
        {isLoading ? (
          <div className="p-8">
            <Spinner />
          </div>
        ) : !rows.length ? (
          <EmptyState icon={<Receipt className="size-6" />} title={t('billing.noInvoices')} description={t('billing.noInvoicesHint')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-6 py-3 font-medium">{t('billing.colNumber')}</th>
                  <th className="px-6 py-3 font-medium">{t('billing.customer')}</th>
                  <th className="hidden px-6 py-3 font-medium md:table-cell">{t('billing.colDate')}</th>
                  <th className="hidden px-6 py-3 font-medium md:table-cell">{t('billing.colDue')}</th>
                  <th className="px-6 py-3 text-right font-medium">{t('billing.colTotal')}</th>
                  <th className="px-6 py-3 font-medium">{t('billing.colStatus')}</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((inv) => (
                  <tr key={inv.id} className="transition hover:bg-sunken/50">
                    <td className="px-6 py-3">
                      <p className="font-mono text-xs font-semibold">{inv.number ?? t('billing.status.draft')}</p>
                      <p className="text-xs text-muted">{inv.source === 'subscription' ? t('billing.sourceSubscription') : t('billing.sourceManual')}</p>
                    </td>
                    <td className="px-6 py-3">
                      <p className="font-medium">{(inv.tenantId && names.get(inv.tenantId)) || inv.customer.name}</p>
                      {inv.periodStart && (
                        <p className="text-xs text-muted">
                          {formatDay(inv.periodStart)} – {formatDay(inv.periodEnd)}
                        </p>
                      )}
                    </td>
                    <td className="hidden px-6 py-3 text-muted md:table-cell">{formatDay(inv.issueDate)}</td>
                    <td className="hidden px-6 py-3 text-muted md:table-cell">{formatDay(inv.dueDate)}</td>
                    <td className="px-6 py-3 text-right font-semibold whitespace-nowrap">{formatMoney(inv.totalCents, inv.currency)}</td>
                    <td className="px-6 py-3">
                      <InvoiceStatus invoice={inv} />
                      {inv.remindersSent > 0 && inv.status === 'open' && <p className="mt-1 text-[11px] text-muted">{t('billing.remindersSent', { count: inv.remindersSent })}</p>}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end gap-0.5">
                        <a className="rounded-lg p-2 text-muted hover:bg-sunken hover:text-ink" href={`/api/billing/invoices/${inv.id}/pdf`} target="_blank" rel="noopener" title={t('billing.pdf')} aria-label={t('billing.pdf')}>
                          <FileText className="size-4" />
                        </a>
                        {inv.status === 'draft' && (
                          <>
                            <Button variant="ghost" size="sm" title={t('common.edit')} aria-label={t('common.edit')} onClick={() => setEditing(inv)}>
                              <Pencil className="size-4" />
                            </Button>
                            <Button variant="ghost" size="sm" title={t('billing.issue')} aria-label={t('billing.issue')} onClick={async () => (await ask(t('billing.confirmIssue'), false)) && act.mutate({ id: inv.id, action: 'issue', body: { send: true } })}>
                              <Stamp className="size-4" />
                            </Button>
                            <Button variant="ghost" size="sm" title={t('common.delete')} aria-label={t('common.delete')} onClick={async () => (await ask(t('billing.confirmDelete'))) && act.mutate({ id: inv.id, action: 'delete' })}>
                              <Trash2 className="size-4" />
                            </Button>
                          </>
                        )}
                        {inv.status === 'open' && (
                          <>
                            {inv.payUrl && (
                              <Button variant="ghost" size="sm" title={t('billing.copyPayLink')} aria-label={t('billing.copyPayLink')} onClick={() => navigator.clipboard.writeText(inv.payUrl!).then(() => toast.success(t('common.copied')))}>
                                <Copy className="size-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              title={inv.overdue ? t('billing.sendReminder') : t('billing.resend')}
                              aria-label={inv.overdue ? t('billing.sendReminder') : t('billing.resend')}
                              onClick={() => act.mutate({ id: inv.id, action: 'send', body: { reminder: inv.overdue } })}
                            >
                              {inv.overdue ? <BellRing className="size-4" /> : <Send className="size-4" />}
                            </Button>
                            <Button variant="ghost" size="sm" title={t('billing.markPaid')} aria-label={t('billing.markPaid')} onClick={() => setPaying(inv)}>
                              <CheckCircle2 className="size-4" />
                            </Button>
                            <Button variant="ghost" size="sm" title={t('billing.void')} aria-label={t('billing.void')} onClick={async () => (await ask(t('billing.confirmVoid', { number: inv.number }))) && act.mutate({ id: inv.id, action: 'void' })}>
                              <Ban className="size-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <InvoiceDialog invoice={editing === 'new' ? null : editing} customers={customers} currency={currency} defaultTenant={tenantFilter || undefined} onClose={() => setEditing(null)} />}
      {paying && <PaidDialog invoice={paying} onClose={() => setPaying(null)} />}
      {confirmDialog}
    </>
  );
}

// ── Customers and subscriptions ──────────────────────────────────────────────

const blankProfile = (tenantId: string, name: string, s?: BillingSettings): Profile => ({
  tenantId,
  companyName: name,
  address: '',
  email: '',
  vatNumber: '',
  reference: '',
  locale: 'nl',
  vatRateBp: s?.defaultVatRateBp ?? 2100,
  reverseCharge: false,
  subscriptionActive: false,
  planId: null,
  planName: '',
  priceCents: 0,
  interval: 'month',
  startDate: null,
  nextInvoiceDate: null,
  autoSuspend: true,
});

function CustomerDialog({ customer, plans, settings, onClose }: { customer: Customer; plans: Plan[]; settings?: BillingSettings; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const initial = customer.profile ?? blankProfile(customer.tenant.id, customer.tenant.name, settings);
  const [f, setF] = useState(initial);
  const [price, setPrice] = useState(centsInput(initial.priceCents));
  const [nextTouched, setNextTouched] = useState(false);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setF((x) => ({ ...x, [k]: v }));
  const currency = settings?.currency ?? 'EUR';
  const save = useMutation({
    mutationFn: () => {
      const { tenantId: _t, nextInvoiceDate, ...rest } = f;
      return api.put(`/billing/customers/${customer.tenant.id}`, { ...rest, priceCents: parseMoney(price) || 0, ...(nextTouched ? { nextInvoiceDate } : {}) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing'] });
      toast.success(t('common.saved'));
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const choosePlan = (id: string) => {
    const plan = plans.find((p) => p.id === id);
    if (!plan) return set('planId', null);
    setF((x) => ({ ...x, planId: plan.id, planName: plan.name, interval: plan.interval }));
    setPrice(centsInput(plan.priceCents));
  };
  const priceCents = parseMoney(price) || 0;
  const vat = f.reverseCharge ? 0 : Math.round((priceCents * f.vatRateBp) / 10_000);
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={customer.tenant.name}
      description={t('billing.customerFormHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="accent" loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <section className="space-y-4">
          <h3 className="text-sm font-semibold">{t('billing.invoiceDetails')}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('billing.companyName')} htmlFor="c-name">
              <Input id="c-name" value={f.companyName} onChange={(e) => set('companyName', e.target.value)} />
            </Field>
            <Field label={t('billing.invoiceEmail')} htmlFor="c-mail" hint={t('billing.invoiceEmailHint', { email: customer.tenant.contactEmail ?? '—' })}>
              <Input id="c-mail" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label={t('billing.address')} htmlFor="c-addr">
              <Textarea id="c-addr" rows={3} className="font-sans text-sm" value={f.address} onChange={(e) => set('address', e.target.value)} />
            </Field>
            <div className="space-y-4">
              <Field label={t('billing.vatNumber')} htmlFor="c-vat">
                <Input id="c-vat" value={f.vatNumber} onChange={(e) => set('vatNumber', e.target.value)} />
              </Field>
              <Field label={t('billing.reference')} htmlFor="c-ref" hint={t('billing.referenceHint')}>
                <Input id="c-ref" value={f.reference} onChange={(e) => set('reference', e.target.value)} />
              </Field>
            </div>
            <Field label={t('billing.invoiceLanguage')} htmlFor="c-lang">
              <Select id="c-lang" value={f.locale} onChange={(e) => set('locale', e.target.value as Profile['locale'])}>
                <option value="nl">Nederlands</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <Field label={t('billing.vatRate')} htmlFor="c-rate">
              <Select id="c-rate" value={f.vatRateBp} disabled={f.reverseCharge} onChange={(e) => set('vatRateBp', Number(e.target.value))}>
                {[...new Set([...VAT_RATES, f.vatRateBp, settings?.defaultVatRateBp ?? 2100])].map((r) => (
                  <option key={r} value={r}>
                    {rateLabel(r)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Switch checked={f.reverseCharge} onChange={(v) => set('reverseCharge', v)} label={t('billing.reverseCharge')} description={t('billing.reverseChargeHint')} />
        </section>

        <section className="space-y-4 border-t border-line pt-5">
          <Switch checked={f.subscriptionActive} onChange={(v) => set('subscriptionActive', v)} label={t('billing.subscription')} description={t('billing.subscriptionHint')} />
          {f.subscriptionActive && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('billing.plan')} htmlFor="c-plan">
                  <Select id="c-plan" value={f.planId ?? ''} onChange={(e) => choosePlan(e.target.value)}>
                    <option value="">{t('billing.customPlan')}</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {formatMoney(p.priceCents, currency)} / {t(`billing.intervals.${p.interval}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('billing.planName')} htmlFor="c-pname" hint={t('billing.planNameHint')}>
                  <Input id="c-pname" value={f.planName} onChange={(e) => set('planName', e.target.value)} />
                </Field>
                <Field label={`${t('billing.priceExVat')} (${currency})`} htmlFor="c-price">
                  <Input id="c-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
                </Field>
                <Field label={t('billing.interval')} htmlFor="c-int">
                  <Select id="c-int" value={f.interval} onChange={(e) => set('interval', e.target.value as Interval)}>
                    {(['month', 'quarter', 'year'] as const).map((i) => (
                      <option key={i} value={i}>
                        {t(`billing.intervalsLong.${i}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('billing.startDate')} htmlFor="c-start" hint={t('billing.startDateHint')}>
                  <Input id="c-start" type="date" value={f.startDate ?? ''} onChange={(e) => set('startDate', e.target.value || null)} />
                </Field>
                {customer.profile?.subscriptionActive && (
                  <Field label={t('billing.nextInvoice')} htmlFor="c-next" hint={t('billing.nextInvoiceHint')}>
                    <Input
                      id="c-next"
                      type="date"
                      value={f.nextInvoiceDate ?? ''}
                      onChange={(e) => {
                        setNextTouched(true);
                        set('nextInvoiceDate', e.target.value || null);
                      }}
                    />
                  </Field>
                )}
              </div>
              <p className="rounded-xl bg-sunken px-4 py-3 text-sm text-muted">
                {t('billing.subscriptionSummary', {
                  price: formatMoney(priceCents + vat, currency),
                  interval: t(`billing.intervals.${f.interval}`),
                  vat: f.reverseCharge ? t('billing.reverseCharge').toLowerCase() : t('billing.inclVat', { rate: rateLabel(f.vatRateBp) }),
                  date: formatDay(nextTouched || customer.profile?.subscriptionActive ? f.nextInvoiceDate : (f.startDate ?? today())),
                })}
              </p>
            </>
          )}
          <Switch checked={f.autoSuspend} onChange={(v) => set('autoSuspend', v)} label={t('billing.customerAutoSuspend')} description={settings?.autoSuspend ? t('billing.customerAutoSuspendHint', { days: settings.suspendAfterDays }) : t('billing.customerAutoSuspendOff')} />
        </section>
      </div>
    </Modal>
  );
}

function Customers({ customers, plans, settings, loading }: { customers: Customer[]; plans: Plan[]; settings?: BillingSettings; loading: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const editId = params.get('edit');
  const editing = customers.find((c) => c.tenant.id === editId) ?? null;
  const currency = settings?.currency ?? 'EUR';
  const open = (id: string | null) => setParams(id ? { tab: 'customers', edit: id } : { tab: 'customers' }, { replace: true });
  const resume = useMutation({
    mutationFn: (id: string) => api.post(`/billing/customers/${id}/resume`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing'] });
      toast.success(t('billing.resumed'));
    },
  });
  if (loading) return <Spinner />;
  return (
    <Card>
      <CardHeader title={t('billing.customersTitle')} description={t('billing.customersHint')} />
      {!customers.length ? (
        <EmptyState icon={<Building2 className="size-6" />} title={t('billing.noCustomers')} description={t('billing.noCustomersHint')} />
      ) : (
        <ul className="divide-y divide-line">
          {customers.map((c) => {
            const p = c.profile;
            return (
              <li key={c.tenant.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-lucht/25 text-sm font-bold text-nacht dark:text-lucht">{c.tenant.name.slice(0, 2).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {p?.companyName || c.tenant.name}
                    {c.tenant.billingSuspendedAt && <Badge tone="offline">{t('billing.portalPaused')}</Badge>}
                    {c.tenant.status === 'suspended' && <Badge tone="warning">{t('common.suspended')}</Badge>}
                  </p>
                  <p className="text-sm text-muted">
                    {p?.subscriptionActive ? (
                      <>
                        {p.planName || t('billing.subscription')} · {formatMoney(p.priceCents, currency)} / {t(`billing.intervals.${p.interval}`)} · {t('billing.nextOn', { date: formatDay(p.nextInvoiceDate) })}
                      </>
                    ) : (
                      t('billing.noSubscription')
                    )}
                  </p>
                </div>
                <div className="text-right text-sm">
                  {c.openCents > 0 ? (
                    <>
                      <p className="font-semibold">{formatMoney(c.openCents, currency)}</p>
                      <p className={cx('text-xs', c.overdueCents ? 'text-offline' : 'text-muted')}>{c.overdueCents ? t('billing.overdueAmount', { amount: formatMoney(c.overdueCents, currency) }) : t('billing.openAmount')}</p>
                    </>
                  ) : (
                    <p className="text-xs text-muted">{t('billing.nothingOpen')}</p>
                  )}
                </div>
                <div className="flex gap-1">
                  {c.tenant.billingSuspendedAt && (
                    <Button variant="secondary" size="sm" icon={<PlayCircle className="size-4" />} loading={resume.isPending} onClick={() => resume.mutate(c.tenant.id)}>
                      {t('billing.resume')}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" title={t('billing.viewInvoices')} aria-label={t('billing.viewInvoices')} onClick={() => setParams({ tab: 'invoices', tenant: c.tenant.id })}>
                    <Receipt className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" title={t('common.edit')} aria-label={t('common.edit')} onClick={() => open(c.tenant.id)}>
                    <Pencil className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <CustomerDialog key={editing.tenant.id} customer={editing} plans={plans.filter((p) => p.active || p.id === editing.profile?.planId)} settings={settings} onClose={() => open(null)} />}
    </Card>
  );
}

// ── Plans ────────────────────────────────────────────────────────────────────

function PlanDialog({ plan, currency, onClose }: { plan: Plan | null; currency: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: plan?.name ?? '', description: plan?.description ?? '', price: centsInput(plan?.priceCents ?? 1995), interval: plan?.interval ?? ('month' as Interval), active: plan?.active ?? true });
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, description: f.description, priceCents: parseMoney(f.price) || 0, interval: f.interval, active: f.active };
      return plan ? api.put(`/billing/plans/${plan.id}`, body) : api.post('/billing/plans', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing'] });
      toast.success(t('common.saved'));
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={plan ? t('billing.editPlan') : t('billing.newPlan')}
      description={t('billing.planFormHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="accent" loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('billing.planName')} htmlFor="pl-name">
          <Input id="pl-name" autoFocus placeholder="Basic" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label={t('billing.planDescription')} htmlFor="pl-desc">
          <Input id="pl-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`${t('billing.priceExVat')} (${currency})`} htmlFor="pl-price">
            <Input id="pl-price" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          </Field>
          <Field label={t('billing.interval')} htmlFor="pl-int">
            <Select id="pl-int" value={f.interval} onChange={(e) => setF({ ...f, interval: e.target.value as Interval })}>
              {(['month', 'quarter', 'year'] as const).map((i) => (
                <option key={i} value={i}>
                  {t(`billing.intervalsLong.${i}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label={t('billing.planActive')} description={t('billing.planActiveHint')} />
      </div>
    </Modal>
  );
}

function Plans({ plans, currency, loading }: { plans: Plan[]; currency: string; loading: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [confirmDialog, ask] = useConfirm();
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/billing/plans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing'] }),
  });
  return (
    <Card>
      <CardHeader
        title={t('billing.plansTitle')}
        description={t('billing.plansHint')}
        action={
          <Button size="sm" variant="accent" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            {t('billing.newPlan')}
          </Button>
        }
      />
      {loading ? (
        <div className="p-6">
          <Spinner />
        </div>
      ) : !plans.length ? (
        <EmptyState icon={<Layers className="size-6" />} title={t('billing.noPlans')} description={t('billing.noPlansHint')} />
      ) : (
        <div className="grid gap-4 p-6 sm:grid-cols-2 xl:grid-cols-3">
          {plans.map((p) => (
            <div key={p.id} className={cx('rounded-2xl border border-line p-5', !p.active && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{p.name}</p>
                {!p.active && <Badge>{t('common.inactive')}</Badge>}
              </div>
              {p.description && <p className="mt-1 text-sm text-muted">{p.description}</p>}
              <p className="display mt-4 text-2xl">
                {formatMoney(p.priceCents, currency)}
                <span className="text-sm font-normal text-muted"> / {t(`billing.intervals.${p.interval}`)}</span>
              </p>
              <p className="text-xs text-muted">{t('billing.exVat')}</p>
              <div className="mt-4 flex gap-1">
                <Button variant="secondary" size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditing(p)}>
                  {t('common.edit')}
                </Button>
                <Button variant="ghost" size="sm" aria-label={t('common.delete')} onClick={async () => (await ask(t('billing.confirmDeletePlan', { name: p.name }))) && remove.mutate(p.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <PlanDialog plan={editing === 'new' ? null : editing} currency={currency} onClose={() => setEditing(null)} />}
      {confirmDialog}
    </Card>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

function Settings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useBillingSettings();
  const [f, setF] = useState<BillingSettings | null>(null);
  const [keys, setKeys] = useState({ mollieApiKey: '', stripeSecretKey: '', stripeWebhookSecret: '' });
  const [reminderText, setReminderText] = useState('');
  useEffect(() => {
    if (!data) return;
    setF(data);
    setReminderText(data.reminderDays.join(', '));
  }, [data]);
  const save = useMutation({
    mutationFn: () => {
      const { mollieApiKeySet: _a, stripeSecretKeySet: _b, stripeWebhookSecretSet: _c, ...rest } = f!;
      const reminderDays = reminderText
        .split(/[\s,;]+/)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, 5);
      return api.put<BillingSettings>('/settings/billing', { ...rest, reminderDays, ...keys });
    },
    onSuccess: (d) => {
      qc.setQueryData(['settings', 'billing'], d);
      setKeys({ mollieApiKey: '', stripeSecretKey: '', stripeWebhookSecret: '' });
      toast.success(t('common.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; mode: 'test' | 'live' }>('/billing/provider-test', { provider: f!.provider, ...keys }),
    onSuccess: (d) => toast.success(t('payments.testOk', { mode: t(`payments.testMode.${d.mode}`) })),
    onError: (e: Error) => toast.error(e.message),
  });
  if (!f) return <Spinner />;
  const set = <K extends keyof BillingSettings>(k: K, v: BillingSettings[K]) => setF({ ...f, [k]: v });
  const text = (k: 'companyName' | 'email' | 'phone' | 'website' | 'vatNumber' | 'cocNumber' | 'iban' | 'bic', type = 'text') => (
    <Field label={t(`billing.settings.${k}`)} htmlFor={`bs-${k}`}>
      <Input id={`bs-${k}`} type={type} value={f[k]} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );
  const example = `${f.numberPrefix.replaceAll('{year}', String(new Date().getFullYear()))}${'1'.padStart(f.numberDigits, '0')}`;
  const providers = [
    { id: 'none', title: t('billing.settings.providerNone'), hint: t('billing.settings.providerNoneHint') },
    { id: 'mollie', title: 'Mollie', hint: t('payments.mollieHint') },
    { id: 'stripe', title: 'Stripe', hint: t('payments.stripeHint') },
  ] as const;
  const origin = window.location.origin;
  return (
    <div className="space-y-6">
      {!f.companyName && <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">{t('billing.settings.companyMissing')}</p>}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title={t('billing.settings.company')} description={t('billing.settings.companyHint')} />
          <div className="grid gap-4 p-6 sm:grid-cols-2">
            {text('companyName')}
            {text('email', 'email')}
            <div className="sm:col-span-2">
              <Field label={t('billing.settings.address')} htmlFor="bs-address">
                <Textarea id="bs-address" rows={3} className="font-sans text-sm" value={f.address} onChange={(e) => set('address', e.target.value)} />
              </Field>
            </div>
            {text('phone')}
            {text('website')}
            {text('vatNumber')}
            {text('cocNumber')}
            {text('iban')}
            {text('bic')}
            <div className="sm:col-span-2">
              <ImageUpload label={t('billing.settings.logo')} value={f.logo} onChange={(v) => set('logo', v)} />
              <p className="mt-1 text-xs text-muted">{t('billing.settings.logoHint')}</p>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title={t('billing.settings.invoices')} />
            <div className="grid gap-4 p-6 sm:grid-cols-2">
              <Field label={t('billing.settings.currency')} htmlFor="bs-cur">
                <Select id="bs-cur" value={f.currency} onChange={(e) => set('currency', e.target.value)}>
                  {['EUR', 'USD', 'GBP', 'CHF'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('billing.settings.defaultVat')} htmlFor="bs-vat">
                <Select id="bs-vat" value={f.defaultVatRateBp} onChange={(e) => set('defaultVatRateBp', Number(e.target.value))}>
                  {[2100, 900, 0, 2000, 1900, 810].map((r) => (
                    <option key={r} value={r}>
                      {rateLabel(r)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('billing.settings.term')} htmlFor="bs-term" hint={t('billing.settings.termHint')}>
                <Input id="bs-term" type="number" min={0} max={120} value={f.paymentTermDays} onChange={(e) => set('paymentTermDays', Number(e.target.value))} />
              </Field>
              <div />
              <Field label={t('billing.settings.prefix')} htmlFor="bs-prefix" hint={t('billing.settings.prefixHint', { example })}>
                <Input id="bs-prefix" className="font-mono" value={f.numberPrefix} onChange={(e) => set('numberPrefix', e.target.value)} />
              </Field>
              <Field label={t('billing.settings.digits')} htmlFor="bs-digits">
                <Input id="bs-digits" type="number" min={1} max={8} value={f.numberDigits} onChange={(e) => set('numberDigits', Number(e.target.value))} />
              </Field>
              <div className="sm:col-span-2">
                <Field label={t('billing.settings.footer')} htmlFor="bs-footer" hint={t('billing.settings.footerHint')}>
                  <Textarea id="bs-footer" rows={2} className="font-sans text-sm" value={f.footer} onChange={(e) => set('footer', e.target.value)} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Switch checked={f.autoSend} onChange={(v) => set('autoSend', v)} label={t('billing.settings.autoSend')} description={t('billing.settings.autoSendHint')} />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title={t('billing.settings.overdue')} />
            <div className="space-y-5 p-6">
              <Switch checked={f.reminders} onChange={(v) => set('reminders', v)} label={t('billing.settings.reminders')} description={t('billing.settings.remindersHint')} />
              {f.reminders && (
                <Field label={t('billing.settings.reminderDays')} htmlFor="bs-rem" hint={t('billing.settings.reminderDaysHint')}>
                  <Input id="bs-rem" value={reminderText} onChange={(e) => setReminderText(e.target.value)} placeholder="7, 14" />
                </Field>
              )}
              <Switch checked={f.autoSuspend} onChange={(v) => set('autoSuspend', v)} label={t('billing.settings.autoSuspend')} description={t('billing.settings.autoSuspendHint')} />
              {f.autoSuspend && (
                <Field label={t('billing.settings.suspendAfter')} htmlFor="bs-susp">
                  <Input id="bs-susp" type="number" min={1} max={365} className="sm:w-40" value={f.suspendAfterDays} onChange={(e) => set('suspendAfterDays', Number(e.target.value))} />
                </Field>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title={t('billing.settings.online')} description={t('billing.settings.onlineHint')} />
        <div className="space-y-5 p-6">
          <div className="grid gap-3 sm:grid-cols-3">
            {providers.map((p) => (
              <button key={p.id} type="button" onClick={() => set('provider', p.id)} className={cx('rounded-2xl border p-4 text-left transition', f.provider === p.id ? 'border-koraal bg-koraal/5 shadow-card' : 'border-line hover:border-muted')}>
                <p className="font-semibold">{p.title}</p>
                <p className="mt-1 text-xs text-muted">{p.hint}</p>
              </button>
            ))}
          </div>
          {f.provider === 'mollie' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('payments.mollieKey')} htmlFor="bs-mk" hint={t('payments.mollieKeyHint')}>
                <Input id="bs-mk" type="password" autoComplete="off" placeholder={f.mollieApiKeySet ? `•••••• (${t('payments.keySet')})` : 'live_…'} value={keys.mollieApiKey} onChange={(e) => setKeys({ ...keys, mollieApiKey: e.target.value })} />
              </Field>
              <div className="space-y-1.5 text-xs text-muted">
                <p>{t('billing.settings.mollieWebhook')}</p>
                <Copyable value={`${origin}/billing/webhooks/mollie`} />
              </div>
            </div>
          )}
          {f.provider === 'stripe' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('payments.stripeKey')} htmlFor="bs-sk" hint={t('payments.stripeKeyHint')}>
                <Input id="bs-sk" type="password" autoComplete="off" placeholder={f.stripeSecretKeySet ? `•••••• (${t('payments.keySet')})` : 'sk_live_…'} value={keys.stripeSecretKey} onChange={(e) => setKeys({ ...keys, stripeSecretKey: e.target.value })} />
              </Field>
              <Field label={t('payments.stripeWebhook')} htmlFor="bs-wh" hint={<span className="block space-y-1.5"><span className="block">{t('payments.stripeWebhookHint')}</span><Copyable value={`${origin}/billing/webhooks/stripe`} /></span>}>
                <Input id="bs-wh" type="password" autoComplete="off" placeholder={f.stripeWebhookSecretSet ? `•••••• (${t('payments.keySet')})` : 'whsec_…'} value={keys.stripeWebhookSecret} onChange={(e) => setKeys({ ...keys, stripeWebhookSecret: e.target.value })} />
              </Field>
            </div>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">
          {f.provider !== 'none' && (
            <Button variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>
              {t('payments.test')}
            </Button>
          )}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button variant="accent" loading={save.isPending} onClick={() => save.mutate()}>
          {t('billing.settings.save')}
        </Button>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function BillingPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'invoices' | 'customers' | 'plans' | 'settings') ?? 'invoices';
  const settings = useBillingSettings();
  const customers = useQuery({ queryKey: ['billing', 'customers'], queryFn: () => api.get<{ customers: Customer[] }>('/billing/customers') });
  const plans = useQuery({ queryKey: ['billing', 'plans'], queryFn: () => api.get<{ plans: Plan[] }>('/billing/plans') });
  const currency = settings.data?.currency ?? 'EUR';
  const tabs = [
    { id: 'invoices', label: t('billing.tabInvoices'), icon: Receipt },
    { id: 'customers', label: t('billing.tabCustomers'), icon: CalendarClock },
    { id: 'plans', label: t('billing.tabPlans'), icon: Layers },
    { id: 'settings', label: t('billing.tabSettings'), icon: Wallet },
  ] as const;
  return (
    <>
      <PageHeader eyebrow={t('billing.eyebrow')} title={t('billing.title')} description={t('billing.description')} />
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
      {tab === 'invoices' && <Invoices customers={customers.data?.customers ?? []} currency={currency} />}
      {tab === 'customers' && <Customers customers={customers.data?.customers ?? []} plans={plans.data?.plans ?? []} settings={settings.data} loading={customers.isLoading} />}
      {tab === 'plans' && <Plans plans={plans.data?.plans ?? []} currency={currency} loading={plans.isLoading} />}
      {tab === 'settings' && <Settings />}
    </>
  );
}
