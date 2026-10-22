import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { loginMethods, type LoginMethod } from '../shared/portalDesign.js';
import { TIME_ZONE } from './reports.js';

/**
 * Figures across all customers for the platform admin: how many guests signed in, through
 * which resellers and customers, and when. Read-only aggregates; nothing per guest leaves here.
 * Days are counted in the server's time zone (TZ, default Europe/Amsterdam).
 */

export const DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** Longest period one report may cover */
export const MAX_DAYS = 366 * 3;

export type Granularity = 'day' | 'week' | 'month';
/** null = all customers, 'direct' = customers without a reseller */
export type StatsFilter = { from: string; to: string; resellerId?: string | 'direct' | null; tenantId?: string | null; granularity?: Granularity | null };

type Totals = {
  guests: number;
  uniqueDevices: number;
  registrations: number;
  activeTenants: number;
  vouchersUsed: number;
  paidSessions: number;
};

export type PlatformStats = {
  from: string;
  to: string;
  days: number;
  granularity: Granularity;
  previous: { from: string; to: string } & Totals;
  totals: Totals & {
    newDevices: number;
    returningDevices: number;
    marketingOptIns: number;
    tenants: number;
    newTenants: number;
    resellers: number;
    activeAdmins: number;
    onlineNow: number;
    guestPayments: number;
    guestRevenue: { currency: string; cents: number }[];
  };
  series: { bucket: string; guests: number; devices: number; tenants: number }[];
  previousSeries: number[];
  /** [weekday 0 = Monday][hour] */
  heatmap: number[][];
  byMethod: Record<LoginMethod | 'other', number>;
  byReseller: { id: string | null; name: string; tenants: number; activeTenants: number; guests: number; devices: number; previousGuests: number }[];
  byTenant: { id: string; name: string; status: string; resellerId: string | null; resellerName: string | null; guests: number; devices: number; registrations: number; previousGuests: number; lastGuestAt: string | null }[];
  peak: { weekday: number; hour: number; count: number } | null;
  busiestDay: { bucket: string; count: number } | null;
};

const n = (v: unknown) => Number(v ?? 0);
const DAY_MS = 86_400_000;
const toUtc = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day: string, delta: number) => new Date(toUtc(day) + delta * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1;

/** Today in the server's time zone, as YYYY-MM-DD. */
export function today(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Days per bar: a day up to two months, a week up to half a year, then a month. */
export function pickGranularity(days: number): Granularity {
  return days <= 62 ? 'day' : days <= 185 ? 'week' : 'month';
}

/** The same number of days directly before the period. */
export function previousPeriod(from: string, to: string) {
  const days = daysBetween(from, to);
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

/** Local midnight at the start of a day, as timestamptz. */
const startOf = (day: string) => sql`(${day}::date::timestamp at time zone ${TIME_ZONE})`;
const local = (col: SQL) => sql`(${col} at time zone ${TIME_ZONE})`;

/** Which customers count: everything, the direct customers, one reseller's, or one customer. */
function scope(f: StatsFilter, alias = 't') {
  const t = sql.raw(alias);
  const parts: SQL[] = [];
  if (f.resellerId === 'direct') parts.push(sql`${t}.reseller_id is null`);
  else if (f.resellerId) parts.push(sql`${t}.reseller_id = ${f.resellerId}`);
  if (f.tenantId) parts.push(sql`${t}.id = ${f.tenantId}`);
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}

function sessionsIn(f: StatsFilter, from: string, to: string) {
  return sql`g.status = 'authorized' and g.authorized_at >= ${startOf(from)} and g.authorized_at < ${startOf(addDays(to, 1))} and ${scope(f)}`;
}

async function totals(f: StatsFilter, from: string, to: string): Promise<Totals> {
  const { rows } = await db.execute(sql`
    select count(*) as guests,
           count(distinct (g.tenant_id, g.client_mac)) as devices,
           count(distinct (g.tenant_id, lower(g.email))) filter (where g.method = 'email') as registrations,
           count(distinct g.tenant_id) as tenants,
           count(*) filter (where g.voucher_id is not null) as vouchers,
           count(*) filter (where g.payment_id is not null) as paid
      from guest_sessions g join tenants t on t.id = g.tenant_id
     where ${sessionsIn(f, from, to)}`);
  const r = rows[0] ?? {};
  return {
    guests: n(r.guests),
    uniqueDevices: n(r.devices),
    registrations: n(r.registrations),
    activeTenants: n(r.tenants),
    vouchersUsed: n(r.vouchers),
    paidSessions: n(r.paid),
  };
}

export async function platformStats(f: StatsFilter): Promise<PlatformStats> {
  const { from, to } = f;
  const days = daysBetween(from, to);
  const granularity = f.granularity ?? pickGranularity(days);
  const unit = sql.raw(`'${granularity}'`);
  const step = sql.raw(`'1 ${granularity}'`);
  const prev = previousPeriod(from, to);
  const where = sessionsIn(f, from, to);
  const start = startOf(from);
  const end = startOf(addDays(to, 1));
  const bucketOf = sql`date_trunc(${unit}, ${local(sql`g.authorized_at`)})::date`;

  const perTenant = (a: string, b: string) => sql`
    select g.tenant_id,
           count(*) as guests,
           count(distinct g.client_mac) as devices,
           count(distinct lower(g.email)) filter (where g.method = 'email') as registrations,
           max(g.authorized_at) as last_at
      from guest_sessions g join tenants t on t.id = g.tenant_id
     where ${sessionsIn(f, a, b)}
     group by g.tenant_id`;

  const [current, previous, extra, series, prevSeries, heat, methods, resellers, tenants, money] = await Promise.all([
    totals(f, from, to),
    totals(f, prev.from, prev.to),
    db.execute(sql`
      select
        (select count(*) filter (where x.first_at >= ${start})
           from (select g.tenant_id, g.client_mac, min(g.authorized_at) as first_at, max(g.authorized_at) as last_at
                   from guest_sessions g join tenants t on t.id = g.tenant_id
                  where g.status = 'authorized' and g.authorized_at < ${end} and ${scope(f)}
                  group by 1, 2) x
          where x.last_at >= ${start}) as new_devices,
        (select count(*) from guest_sessions g join tenants t on t.id = g.tenant_id where ${where} and g.marketing_opt_in) as opt_ins,
        (select count(*) from tenants t where ${scope(f)}) as tenants,
        (select count(*) from tenants t where ${scope(f)} and t.created_at >= ${start} and t.created_at < ${end}) as new_tenants,
        (${f.resellerId || f.tenantId ? sql`select count(distinct t.reseller_id) from tenants t where ${scope(f)}` : sql`select count(*) from resellers`}) as resellers,
        (select count(*) from guest_sessions g join tenants t on t.id = g.tenant_id
          where ${scope(f)} and g.status = 'authorized' and g.access_until > now()) as online_now,
        (select count(*) from users u left join tenants t on t.id = u.tenant_id
          where u.is_active and u.last_login_at >= ${start} and u.last_login_at < ${end}
            and ${
              f.tenantId
                ? sql`u.tenant_id = ${f.tenantId}`
                : f.resellerId === 'direct'
                  ? sql`(u.role = 'superadmin' or (t.id is not null and t.reseller_id is null))`
                  : f.resellerId
                    ? sql`(u.reseller_id = ${f.resellerId} or t.reseller_id = ${f.resellerId})`
                    : sql`true`
            }) as active_admins`),
    db.execute(sql`
      with b as (select generate_series(date_trunc(${unit}, ${from}::date::timestamp), ${to}::date::timestamp, ${step}::interval)::date as bucket),
           c as (select ${bucketOf} as bucket, count(*) as guests, count(distinct (g.tenant_id, g.client_mac)) as devices, count(distinct g.tenant_id) as tenants
                   from guest_sessions g join tenants t on t.id = g.tenant_id where ${where} group by 1)
      select to_char(b.bucket, 'YYYY-MM-DD') as bucket, coalesce(c.guests, 0) as guests, coalesce(c.devices, 0) as devices, coalesce(c.tenants, 0) as tenants
        from b left join c using (bucket) order by b.bucket`),
    db.execute(sql`
      with b as (select generate_series(date_trunc(${unit}, ${prev.from}::date::timestamp), ${prev.to}::date::timestamp, ${step}::interval)::date as bucket),
           c as (select ${bucketOf} as bucket, count(*) as guests
                   from guest_sessions g join tenants t on t.id = g.tenant_id where ${sessionsIn(f, prev.from, prev.to)} group by 1)
      select coalesce(c.guests, 0) as guests from b left join c using (bucket) order by b.bucket`),
    db.execute(sql`
      select extract(isodow from ${local(sql`g.authorized_at`)})::int - 1 as d, extract(hour from ${local(sql`g.authorized_at`)})::int as h, count(*) as c
        from guest_sessions g join tenants t on t.id = g.tenant_id where ${where} group by 1, 2`),
    db.execute(sql`select coalesce(g.method, 'other') as k, count(*) as c from guest_sessions g join tenants t on t.id = g.tenant_id where ${where} group by 1`),
    db.execute(sql`
      with cur as (${perTenant(from, to)}), pre as (${perTenant(prev.from, prev.to)})
      select t.reseller_id as id, r.name,
             count(*) as tenants, count(cur.tenant_id) as active,
             coalesce(sum(cur.guests), 0) as guests, coalesce(sum(cur.devices), 0) as devices, coalesce(sum(pre.guests), 0) as prev_guests
        from tenants t
        left join resellers r on r.id = t.reseller_id
        left join cur on cur.tenant_id = t.id
        left join pre on pre.tenant_id = t.id
       where ${scope(f)}
       group by t.reseller_id, r.name
       order by 5 desc, 2 nulls first`),
    db.execute(sql`
      with cur as (${perTenant(from, to)}), pre as (${perTenant(prev.from, prev.to)})
      select t.id, t.name, t.status, t.reseller_id, r.name as reseller_name,
             coalesce(cur.guests, 0) as guests, coalesce(cur.devices, 0) as devices, coalesce(cur.registrations, 0) as registrations,
             coalesce(pre.guests, 0) as prev_guests, cur.last_at
        from tenants t
        left join resellers r on r.id = t.reseller_id
        left join cur on cur.tenant_id = t.id
        left join pre on pre.tenant_id = t.id
       where ${scope(f)}
       order by 6 desc, t.name
       limit 2000`),
    db.execute(sql`
      select p.currency, count(*) as count, sum(p.amount_cents) as cents
        from payments p join tenants t on t.id = p.tenant_id
       where p.status = 'paid' and p.paid_at >= ${start} and p.paid_at < ${end} and ${scope(f)}
       group by 1 order by 1`),
  ]);

  const e = extra.rows[0] ?? {};
  const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const r of heat.rows) heatmap[n(r.d)][n(r.h)] = n(r.c);
  let peak: PlatformStats['peak'] = null;
  heatmap.forEach((row, d) => row.forEach((c, h) => c > (peak?.count ?? 0) && (peak = { weekday: d, hour: h, count: c })));

  const byMethod = Object.fromEntries([...loginMethods, 'other'].map((m) => [m, 0])) as Record<LoginMethod | 'other', number>;
  for (const r of methods.rows) {
    const k = String(r.k) as keyof typeof byMethod;
    byMethod[k in byMethod ? k : 'other'] += n(r.c);
  }

  const seriesRows = series.rows.map((r) => ({ bucket: String(r.bucket), guests: n(r.guests), devices: n(r.devices), tenants: n(r.tenants) }));
  const busiest = seriesRows.reduce<PlatformStats['busiestDay']>((best, r) => (r.guests > (best?.count ?? 0) ? { bucket: r.bucket, count: r.guests } : best), null);

  return {
    from,
    to,
    days,
    granularity,
    previous: { ...prev, ...previous },
    totals: {
      ...current,
      newDevices: n(e.new_devices),
      returningDevices: Math.max(0, current.uniqueDevices - n(e.new_devices)),
      marketingOptIns: n(e.opt_ins),
      tenants: n(e.tenants),
      newTenants: n(e.new_tenants),
      resellers: n(e.resellers),
      activeAdmins: n(e.active_admins),
      onlineNow: n(e.online_now),
      guestPayments: money.rows.reduce((s, p) => s + n(p.count), 0),
      guestRevenue: money.rows.map((p) => ({ currency: String(p.currency), cents: n(p.cents) })),
    },
    series: seriesRows,
    previousSeries: prevSeries.rows.map((r) => n(r.guests)),
    heatmap,
    byMethod,
    byReseller: resellers.rows.map((r) => ({
      id: (r.id as string | null) ?? null,
      name: r.name ? String(r.name) : '',
      tenants: n(r.tenants),
      activeTenants: n(r.active),
      guests: n(r.guests),
      devices: n(r.devices),
      previousGuests: n(r.prev_guests),
    })),
    byTenant: tenants.rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      status: String(r.status),
      resellerId: (r.reseller_id as string | null) ?? null,
      resellerName: (r.reseller_name as string | null) ?? null,
      guests: n(r.guests),
      devices: n(r.devices),
      registrations: n(r.registrations),
      previousGuests: n(r.prev_guests),
      lastGuestAt: r.last_at ? new Date(r.last_at as string).toISOString() : null,
    })),
    peak,
    busiestDay: busiest,
  };
}
