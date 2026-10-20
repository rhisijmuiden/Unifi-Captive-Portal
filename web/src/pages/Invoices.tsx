import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CreditCard, FileText, Receipt } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, EmptyState, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { formatDay, formatMoney } from '../lib/format';
import { InvoiceStatus, type Invoice } from './Billing';

type Data = {
  invoices: Invoice[];
  subscription: { planName: string; priceCents: number; interval: 'month' | 'quarter' | 'year'; vatRateBp: number; nextInvoiceDate: string | null } | null;
  currency: string;
  company: string;
  canPayOnline: boolean;
  suspended: boolean;
};

/** A customer's own invoices for their portal, with the PDF and online payment. */
export function InvoicesPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({ queryKey: ['invoices'], queryFn: () => api.get<Data>('/invoices'), refetchInterval: 60_000 });
  const open = (data?.invoices ?? []).filter((i) => i.status === 'open');
  const due = open.reduce((s, i) => s + i.totalCents, 0);
  const sub = data?.subscription;
  return (
    <>
      <PageHeader eyebrow={t('billing.subscription')} title={t('invoices.title')} description={t('invoices.description', { company: data?.company || 'RHIS' })} />
      {data?.suspended && (
        <div className="mb-6 flex gap-3 rounded-2xl border border-offline/30 bg-offline/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-offline" />
          <div>
            <p className="font-semibold">{t('invoices.suspendedTitle')}</p>
            <p className="text-muted">{t('invoices.suspendedText')}</p>
          </div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <span className="grid size-10 place-items-center rounded-xl bg-koraal/12 text-accent">
            <CreditCard className="size-5" />
          </span>
          <p className="display mt-4 text-3xl">{formatMoney(due, data?.currency)}</p>
          <p className="text-sm text-muted">{open.length ? t('invoices.toPay', { count: open.length }) : t('invoices.allPaid')}</p>
        </Card>
        <Card className="p-5">
          <span className="grid size-10 place-items-center rounded-xl bg-koraal/12 text-accent">
            <CalendarClock className="size-5" />
          </span>
          {sub ? (
            <>
              <p className="display mt-4 text-3xl">
                {formatMoney(sub.priceCents, data?.currency)}
                <span className="text-base font-normal text-muted"> / {t(`billing.intervals.${sub.interval}`)}</span>
              </p>
              <p className="text-sm text-muted">
                {sub.planName || t('billing.subscription')} · {t('billing.exVat')} · {t('billing.nextOn', { date: formatDay(sub.nextInvoiceDate) })}
              </p>
            </>
          ) : (
            <>
              <p className="display mt-4 text-3xl">—</p>
              <p className="text-sm text-muted">{t('invoices.noSubscription')}</p>
            </>
          )}
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title={t('invoices.listTitle')} />
        {isLoading ? (
          <div className="p-8">
            <Spinner />
          </div>
        ) : !data?.invoices.length ? (
          <EmptyState icon={<Receipt className="size-6" />} title={t('invoices.empty')} description={t('invoices.emptyHint')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-6 py-3 font-medium">{t('billing.colNumber')}</th>
                  <th className="hidden px-6 py-3 font-medium sm:table-cell">{t('billing.colDate')}</th>
                  <th className="hidden px-6 py-3 font-medium md:table-cell">{t('billing.colDue')}</th>
                  <th className="px-6 py-3 text-right font-medium">{t('billing.colTotal')}</th>
                  <th className="px-6 py-3 font-medium">{t('billing.colStatus')}</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.invoices.map((inv) => (
                  <tr key={inv.id} className="transition hover:bg-sunken/50">
                    <td className="px-6 py-3">
                      <p className="font-mono text-xs font-semibold">{inv.number}</p>
                      {inv.periodStart && (
                        <p className="text-xs text-muted">
                          {formatDay(inv.periodStart)} – {formatDay(inv.periodEnd)}
                        </p>
                      )}
                    </td>
                    <td className="hidden px-6 py-3 text-muted sm:table-cell">{formatDay(inv.issueDate)}</td>
                    <td className="hidden px-6 py-3 text-muted md:table-cell">{formatDay(inv.dueDate)}</td>
                    <td className="px-6 py-3 text-right font-semibold whitespace-nowrap">{formatMoney(inv.totalCents, inv.currency)}</td>
                    <td className="px-6 py-3">
                      <InvoiceStatus invoice={inv} />
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex justify-end gap-1">
                        {inv.status === 'open' && inv.payUrl && data.canPayOnline && (
                          <a href={inv.payUrl} target="_blank" rel="noopener" className="inline-flex h-8 items-center rounded-[10px] bg-koraal px-3 text-sm font-semibold text-nacht transition hover:brightness-105">
                            {t('invoices.pay')}
                          </a>
                        )}
                        <a className="rounded-lg p-2 text-muted hover:bg-sunken hover:text-ink" href={`/api/billing/invoices/${inv.id}/pdf?download=1`} title={t('billing.pdf')} aria-label={t('billing.pdf')}>
                          <FileText className="size-4" />
                        </a>
                      </div>
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
