import { useMutation, useQuery } from '@tanstack/react-query';
import { BarChart3, ChevronLeft, ChevronRight, CreditCard, Mail, Smartphone, Ticket, UserCheck, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button, Card, CardHeader, EmptyState, PageHeader, Spinner, cx } from '../components/ui';
import i18n from '../i18n';
import { api } from '../lib/api';
import { useTenantScope } from '../lib/tenant';

type Report = {
  month: string;
  guests: number;
  uniqueDevices: number;
  registrations: number;
  marketingOptIns: number;
  vouchersUsed: number;
  payments: number;
  revenue: { currency: string; cents: number }[];
  byDay: number[];
  byHour: number[];
  byMethod: Record<'free' | 'email' | 'voucher' | 'payment' | 'facebook' | 'other', number>;
  bySite: { name: string; count: number }[];
  peakDay: { day: number; count: number } | null;
  peakHour: { hour: number; count: number } | null;
  previous: { guests: number; uniqueDevices: number; registrations: number; payments: number };
};

const loc = () => (i18n.resolvedLanguage === 'nl' ? 'nl-NL' : 'en-GB');
const num = (v: number) => new Intl.NumberFormat(loc()).format(v);
const shift = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const lastMonth = () => shift(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`, -1);
const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(loc(), { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 15));
};

function Stat({ icon, label, value, now, before }: { icon: ReactNode; label: string; value: ReactNode; now?: number; before?: number }) {
  const { t } = useTranslation();
  const change = before ? Math.round((((now ?? 0) - before) / before) * 100) : null;
  return (
    <Card className="p-5">
      <span className="grid size-10 place-items-center rounded-xl bg-koraal/12 text-accent">{icon}</span>
      <p className="display mt-4 text-3xl">{value}</p>
      <p className="text-sm text-muted">{label}</p>
      {change !== null && (
        <p className={cx('mt-1 text-xs font-semibold', change >= 0 ? 'text-online' : 'text-offline')}>
          {change >= 0 ? '+' : ''}
          {change}% <span className="font-normal text-muted">{t('reports.vsPrevious')}</span>
        </p>
      )}
    </Card>
  );
}

/** Vertical bars with the value on hover; labels every few bars. */
function Bars({ values, label, every = 1 }: { values: number[]; label: (i: number) => string; every?: number }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-44 items-end gap-[3px]" role="img" aria-label={values.map((v, i) => `${label(i)}: ${v}`).join(', ')}>
      {values.map((v, i) => (
        <div key={i} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
          <div className="rounded-t-[3px] bg-koraal/85 transition group-hover:bg-koraal" style={{ height: `${Math.max(v ? 3 : 1, (v / max) * 100)}%`, opacity: v ? 1 : 0.25 }} />
          <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 rounded-md bg-nacht px-1.5 py-0.5 text-[11px] whitespace-nowrap text-white group-hover:block">
            {label(i)}: {num(v)}
          </span>
          <span className="mt-1 h-3 text-center text-[10px] text-muted">{i % every === 0 ? label(i) : ''}</span>
        </div>
      ))}
    </div>
  );
}

function Rows({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex justify-between text-sm">
            <span>{r.label}</span>
            <span className="font-semibold">{num(r.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full bg-koraal" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ReportsPage() {
  const { t } = useTranslation();
  const scope = useTenantScope();
  const [params, setParams] = useSearchParams();
  const month = params.get('month') ?? lastMonth();
  const { data, isLoading } = useQuery({ queryKey: ['report', month], queryFn: () => api.get<{ report: Report }>(`/reports/monthly?month=${month}`) });
  const send = useMutation({
    mutationFn: () => api.post<{ ok: boolean; to?: string; error?: string }>(`/reports/monthly/send?month=${month}`),
    onSuccess: (d) => (d.ok ? toast.success(t('reports.sent', { to: d.to })) : toast.error(d.error)),
    onError: (e: Error) => toast.error(e.message),
  });
  const r = data?.report;
  const thisMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const revenue = r?.revenue.length
    ? r.revenue.map((x) => new Intl.NumberFormat(loc(), { style: 'currency', currency: x.currency }).format(x.cents / 100)).join(' + ')
    : new Intl.NumberFormat(loc(), { style: 'currency', currency: 'EUR' }).format(0);
  const [y, m] = month.split('-').map(Number);

  return (
    <>
      <PageHeader
        eyebrow={t('nav.insights')}
        title={t('reports.title')}
        description={t('reports.description')}
        actions={
          scope.canManage && (
            <Button variant="secondary" icon={<Mail className="size-4" />} loading={send.isPending} onClick={() => send.mutate()}>
              {t('reports.sendMe')}
            </Button>
          )
        }
      />
      <div className="mb-6 flex items-center gap-2">
        <Button variant="secondary" size="sm" aria-label={t('reports.previous')} onClick={() => setParams({ month: shift(month, -1) }, { replace: true })}>
          <ChevronLeft className="size-4" />
        </Button>
        <p className="display min-w-[180px] text-center text-lg capitalize">{monthLabel(month)}</p>
        <Button variant="secondary" size="sm" aria-label={t('reports.next')} disabled={month >= thisMonth} onClick={() => setParams({ month: shift(month, 1) }, { replace: true })}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
      {isLoading || !r ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Stat icon={<UserCheck className="size-5" />} label={t('reports.guests')} value={num(r.guests)} now={r.guests} before={r.previous.guests} />
            <Stat icon={<Smartphone className="size-5" />} label={t('reports.devices')} value={num(r.uniqueDevices)} now={r.uniqueDevices} before={r.previous.uniqueDevices} />
            <Stat icon={<Mail className="size-5" />} label={t('reports.registrations')} value={num(r.registrations)} now={r.registrations} before={r.previous.registrations} />
            <Stat icon={<Ticket className="size-5" />} label={t('reports.vouchers')} value={num(r.vouchersUsed)} />
            <Stat icon={<CreditCard className="size-5" />} label={t('reports.payments')} value={num(r.payments)} now={r.payments} before={r.previous.payments} />
            <Stat icon={<Wallet className="size-5" />} label={t('reports.revenue')} value={revenue} />
          </div>
          {!r.guests ? (
            <Card>
              <EmptyState icon={<BarChart3 className="size-6" />} title={t('reports.noData')} description={t('reports.description')} />
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader title={t('reports.byDay')} description={r.peakDay ? `${t('reports.peakDay')}: ${new Intl.DateTimeFormat(loc(), { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(y, m - 1, r.peakDay.day))} (${num(r.peakDay.count)})` : undefined} />
                <div className="px-6 pt-10 pb-4">
                  <Bars values={r.byDay} label={(i) => String(i + 1)} every={5} />
                </div>
              </Card>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader title={t('reports.byHour')} description={r.peakHour ? `${t('reports.peakHour')}: ${String(r.peakHour.hour).padStart(2, '0')}:00–${String(r.peakHour.hour + 1).padStart(2, '0')}:00` : undefined} />
                  <div className="px-6 pt-10 pb-4">
                    <Bars values={r.byHour} label={(i) => `${String(i).padStart(2, '0')}h`} every={6} />
                  </div>
                </Card>
                <Card>
                  <CardHeader title={t('reports.byMethod')} description={r.marketingOptIns ? `${t('reports.optIns')}: ${num(r.marketingOptIns)}` : undefined} />
                  <div className="p-6">
                    <Rows rows={(Object.keys(r.byMethod) as (keyof Report['byMethod'])[]).filter((k) => r.byMethod[k]).map((k) => ({ label: t(`reports.methods.${k}`), value: r.byMethod[k] }))} />
                  </div>
                </Card>
              </div>
              {r.bySite.length > 1 && (
                <Card>
                  <CardHeader title={t('reports.bySite')} />
                  <div className="p-6">
                    <Rows rows={r.bySite.map((s) => ({ label: s.name, value: s.count }))} />
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
