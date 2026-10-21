import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db, schema } from '../db/index.js';
import { tenantScope } from '../lib/auth.js';
import { TIME_ZONE } from '../services/reports.js';

const n = (v: unknown) => Number(v ?? 0);

/**
 * The live dashboard of a customer: who is online now, today's connections hour by hour
 * (compared with the same weekday last week), the latest sign-ins and the state of the consoles
 * and access points. The page polls this every few seconds.
 */
export async function liveRoutes(app: FastifyInstance) {
  app.get('/api/live', async (req) => {
    const tenantId = tenantScope(req);
    const now = new Date();
    const today = sql`(date_trunc('day', now() at time zone ${TIME_ZONE}) at time zone ${TIME_ZONE})`;
    const authorized = sql`g.tenant_id = ${tenantId} and g.status = 'authorized'`;
    const hour = sql`extract(hour from g.authorized_at at time zone ${TIME_ZONE})::int`;

    const [online, onlineAps, totals, lastWeek, hours, lastWeekHours, methods, recent, consoles, devices] = await Promise.all([
      db.execute(sql`
        select coalesce(s.display_name, '—') as name, count(*) as c
          from guest_sessions g left join console_sites s on s.id = g.console_site_id
         where ${authorized} and g.access_until > now()
         group by 1 order by 2 desc`),
      db.execute(sql`
        select coalesce(d.name, g.ap_mac, '—') as name, count(*) as c
          from guest_sessions g left join console_devices d on d.mac = g.ap_mac
         where ${authorized} and g.access_until > now()
         group by 1 order by 2 desc limit 12`),
      db.execute(sql`
        select count(*) as connections,
               count(distinct g.client_mac) as devices,
               count(*) filter (where g.email is not null or g.phone is not null) as registrations,
               count(*) filter (where g.authorized_at > now() - interval '1 hour') as last_hour
          from guest_sessions g
         where ${authorized} and g.authorized_at >= ${today}`),
      // The same part of the day one week ago, for the "vs. last week" comparison
      db.execute(sql`
        select count(*) as connections
          from guest_sessions g
         where ${authorized} and g.authorized_at >= ${today} - interval '7 days' and g.authorized_at < now() - interval '7 days'`),
      db.execute(sql`select ${hour} as k, count(*) as c from guest_sessions g where ${authorized} and g.authorized_at >= ${today} group by 1`),
      db.execute(sql`
        select ${hour} as k, count(*) as c from guest_sessions g
         where ${authorized} and g.authorized_at >= ${today} - interval '7 days' and g.authorized_at < ${today} - interval '6 days' group by 1`),
      db.execute(sql`select coalesce(g.method, 'other') as k, count(*) as c from guest_sessions g where ${authorized} and g.authorized_at >= ${today} group by 1 order by 2 desc`),
      db
        .select({
          id: schema.guestSessions.id,
          method: schema.guestSessions.method,
          name: schema.guestSessions.name,
          email: schema.guestSessions.email,
          phone: schema.guestSessions.phone,
          clientMac: schema.guestSessions.clientMac,
          ssid: schema.guestSessions.ssid,
          siteName: schema.consoleSites.displayName,
          authorizedAt: schema.guestSessions.authorizedAt,
          accessUntil: schema.guestSessions.accessUntil,
        })
        .from(schema.guestSessions)
        .leftJoin(schema.consoleSites, eq(schema.consoleSites.id, schema.guestSessions.consoleSiteId))
        .where(and(eq(schema.guestSessions.tenantId, tenantId), eq(schema.guestSessions.status, 'authorized'), isNotNull(schema.guestSessions.authorizedAt)))
        .orderBy(desc(schema.guestSessions.authorizedAt))
        .limit(12),
      db.execute(sql`
        select c.id, c.name, c.status, c.offline_since, c.last_sync_at, c.last_error,
               count(d.mac) as aps,
               count(d.mac) filter (where d.offline_since is not null) as aps_offline
          from consoles c
          left join console_sites s on s.console_id = c.id
          left join console_devices d on d.console_site_id = s.id
         where c.tenant_id = ${tenantId}
         group by c.id order by c.name`),
      db
        .select({ mac: schema.consoleDevices.mac, name: schema.consoleDevices.name, model: schema.consoleDevices.model, siteName: schema.consoleSites.displayName, offlineSince: schema.consoleDevices.offlineSince })
        .from(schema.consoleDevices)
        .innerJoin(schema.consoleSites, eq(schema.consoleSites.id, schema.consoleDevices.consoleSiteId))
        .where(and(eq(schema.consoleDevices.tenantId, tenantId), isNotNull(schema.consoleDevices.offlineSince)))
        .orderBy(schema.consoleDevices.offlineSince)
        .limit(20),
    ]);

    const byHour = Array.from({ length: 24 }, () => 0);
    for (const r of hours.rows) byHour[n(r.k)] = n(r.c);
    const byHourLastWeek = Array.from({ length: 24 }, () => 0);
    for (const r of lastWeekHours.rows) byHourLastWeek[n(r.k)] = n(r.c);
    const t = totals.rows[0] ?? {};
    const onlineSites = online.rows.map((r) => ({ name: String(r.name), count: n(r.c) }));
    const localHour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: TIME_ZONE }).format(now)) % 24;

    return {
      now,
      timeZone: TIME_ZONE,
      currentHour: localHour,
      online: onlineSites.reduce((sum, s) => sum + s.count, 0),
      onlineBySite: onlineSites,
      onlineByAccessPoint: onlineAps.rows.map((r) => ({ name: String(r.name), count: n(r.c) })),
      today: { connections: n(t.connections), devices: n(t.devices), registrations: n(t.registrations), lastHour: n(t.last_hour) },
      lastWeek: { connections: n(lastWeek.rows[0]?.connections) },
      byHour,
      byHourLastWeek,
      byMethod: methods.rows.map((r) => ({ method: String(r.k), count: n(r.c) })),
      recent: recent.map((r) => ({ ...r, online: Boolean(r.accessUntil && r.accessUntil > now) })),
      consoles: consoles.rows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        status: String(r.status),
        offlineSince: r.offline_since ? new Date(String(r.offline_since)) : null,
        lastSyncAt: r.last_sync_at ? new Date(String(r.last_sync_at)) : null,
        lastError: (r.last_error as string | null) ?? null,
        accessPoints: n(r.aps),
        accessPointsOffline: n(r.aps_offline),
      })),
      offlineDevices: devices,
    };
  });
}
