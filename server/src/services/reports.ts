import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { loginMethods, type LoginMethod } from '../shared/portalDesign.js';

/** Monthly figures per customer, in the server's time zone (TZ, default Europe/Amsterdam). */

export const TIME_ZONE = process.env.TZ || 'Europe/Amsterdam';
export const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type MonthlyStats = {
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
  byMethod: Record<LoginMethod | 'other', number>;
  bySite: { name: string; count: number }[];
  peakDay: { day: number; count: number } | null;
  peakHour: { hour: number; count: number } | null;
  previous: { guests: number; uniqueDevices: number; registrations: number; payments: number };
};

export function previousMonth(now = new Date()) {
  const local = new Date(now.toLocaleString('en-US', { timeZone: TIME_ZONE }));
  const d = new Date(local.getFullYear(), local.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const range = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return sql`make_timestamptz(${y}, ${m}, 1, 0, 0, 0, ${TIME_ZONE})`;
};

const n = (v: unknown) => Number(v ?? 0);

async function totals(tenantId: string, month: string) {
  const start = range(month);
  const { rows } = await db.execute(sql`
    select count(*) as guests,
           count(distinct client_mac) as devices,
           count(distinct lower(email)) filter (where method = 'email') as registrations,
           count(*) filter (where marketing_opt_in) as opt_ins,
           count(*) filter (where voucher_id is not null) as vouchers
      from guest_sessions
     where tenant_id = ${tenantId} and status = 'authorized'
       and authorized_at >= ${start} and authorized_at < ${start} + interval '1 month'`);
  const { rows: pay } = await db.execute(sql`
    select currency, count(*) as count, sum(amount_cents) as cents
      from payments
     where tenant_id = ${tenantId} and status = 'paid'
       and paid_at >= ${start} and paid_at < ${start} + interval '1 month'
     group by currency order by currency`);
  const r = rows[0] ?? {};
  return {
    guests: n(r.guests),
    uniqueDevices: n(r.devices),
    registrations: n(r.registrations),
    marketingOptIns: n(r.opt_ins),
    vouchersUsed: n(r.vouchers),
    payments: pay.reduce((sum, p) => sum + n(p.count), 0),
    revenue: pay.map((p) => ({ currency: String(p.currency), cents: n(p.cents) })),
  };
}

export async function monthlyStats(tenantId: string, month: string): Promise<MonthlyStats> {
  const start = range(month);
  const local = sql`(authorized_at at time zone ${TIME_ZONE})`;
  const where = sql`g.tenant_id = ${tenantId} and g.status = 'authorized' and g.authorized_at >= ${start} and g.authorized_at < ${start} + interval '1 month'`;
  const [current, prev, days, hours, methods, sites] = await Promise.all([
    totals(tenantId, month),
    totals(tenantId, shiftMonth(month, -1)),
    db.execute(sql`select extract(day from ${local})::int as k, count(*) as c from guest_sessions g where ${where} group by 1`),
    db.execute(sql`select extract(hour from ${local})::int as k, count(*) as c from guest_sessions g where ${where} group by 1`),
    db.execute(sql`select coalesce(method, 'other') as k, count(*) as c from guest_sessions g where ${where} group by 1`),
    db.execute(sql`select coalesce(s.display_name, '—') as k, count(*) as c from guest_sessions g left join console_sites s on s.id = g.console_site_id where ${where} group by 1 order by 2 desc limit 10`),
  ]);
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const byDay = Array.from({ length: daysInMonth }, () => 0);
  for (const r of days.rows) byDay[n(r.k) - 1] = n(r.c);
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const r of hours.rows) byHour[n(r.k)] = n(r.c);
  const byMethod = Object.fromEntries([...loginMethods, 'other'].map((m) => [m, 0])) as Record<LoginMethod | 'other', number>;
  for (const r of methods.rows) {
    const k = String(r.k) as keyof typeof byMethod;
    byMethod[k in byMethod ? k : 'other'] += n(r.c);
  }
  const peak = (list: number[]) => list.reduce((best, c, i) => (c > (best?.count ?? 0) ? { i, count: c } : best), null as { i: number; count: number } | null);
  const pd = peak(byDay);
  const ph = peak(byHour);
  return {
    month,
    ...current,
    byDay,
    byHour,
    byMethod,
    bySite: sites.rows.map((r) => ({ name: String(r.k), count: n(r.c) })),
    peakDay: pd ? { day: pd.i + 1, count: pd.count } : null,
    peakHour: ph ? { hour: ph.i, count: ph.count } : null,
    previous: { guests: prev.guests, uniqueDevices: prev.uniqueDevices, registrations: prev.registrations, payments: prev.payments },
  };
}
