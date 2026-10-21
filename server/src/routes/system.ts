import { and, count, desc, eq, gte, inArray, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit, requireSuperadmin, requireUser } from '../lib/auth.js';
import { requestLocale } from '../i18n/index.js';
import { badRequest, translateError } from '../lib/errors.js';
import { getSettings } from '../services/settings.js';
import { tenantIdsOfReseller } from '../services/resellers.js';
import { checkForUpdates, readUpdateStatus, requestUpdate, selfUpdateEnabled, systemInfo } from '../services/updater.js';

export async function systemRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/system/info', async (req) => {
    const user = requireUser(req);
    const info = systemInfo();
    // Customers only see the version; host details are for platform admins
    if (user.role !== 'superadmin') return { version: info.version, repository: info.repository };
    const { updateChannel } = await getSettings('system');
    return { ...info, channel: updateChannel, selfUpdate: await selfUpdateEnabled(), update: await readUpdateStatus() };
  });

  app.get<{ Querystring: { force?: string } }>('/api/system/updates', async (req) => {
    requireSuperadmin(req);
    try {
      const { updateChannel } = await getSettings('system');
      return await checkForUpdates(updateChannel, req.query.force === '1');
    } catch (err) {
      throw badRequest('errors.updateCheckFailed', { reason: translateError(err, requestLocale(req)) });
    }
  });

  app.get('/api/system/update/status', async (req) => {
    requireSuperadmin(req);
    return readUpdateStatus();
  });

  app.post('/api/system/update', async (req) => {
    const user = requireSuperadmin(req);
    const { version, system } = z
      .object({ version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/), system: z.boolean().default(false) })
      .parse(req.body);
    try {
      await requestUpdate(version, system, user.email);
    } catch (err) {
      throw err;
    }
    await audit(req, 'system.update_requested', { version, system }, null);
    return { ok: true };
  });

  app.get('/api/dashboard', async (req) => {
    const user = requireUser(req);
    if (user.role === 'reseller_admin') return resellerDashboard(user.resellerId!);
    const own = user.role === 'superadmin' ? null : user.tenantId!;
    const scope = own ? eq(schema.auditLog.tenantId, own) : undefined;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [[tenantCount], [userCount], [consoleCount], [hostnameCount], [guestCount], portal, hosting, activity] = await Promise.all([
      db.select({ value: count() }).from(schema.tenants),
      db.select({ value: count() }).from(schema.users).where(own ? eq(schema.users.tenantId, own) : undefined),
      db.select({ value: count() }).from(schema.consoles).where(own ? eq(schema.consoles.tenantId, own) : undefined),
      db
        .select({ value: count() })
        .from(schema.hostnames)
        .where(and(eq(schema.hostnames.status, 'active'), own ? eq(schema.hostnames.tenantId, own) : undefined)),
      db
        .select({ value: count() })
        .from(schema.guestSessions)
        .where(and(eq(schema.guestSessions.status, 'authorized'), gte(schema.guestSessions.authorizedAt, startOfDay), own ? eq(schema.guestSessions.tenantId, own) : undefined)),
      own ? db.query.portalSettings.findFirst({ where: eq(schema.portalSettings.tenantId, own) }) : Promise.resolve(undefined),
      getSettings('hosting'),
      db
        .select({ id: schema.auditLog.id, action: schema.auditLog.action, details: schema.auditLog.details, createdAt: schema.auditLog.createdAt, userName: schema.users.name })
        .from(schema.auditLog)
        .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.userId))
        .where(scope)
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(12),
    ]);
    return {
      tenants: own ? null : tenantCount.value,
      users: userCount.value,
      consoles: consoleCount.value,
      activeHostnames: hostnameCount.value,
      guestsToday: guestCount.value,
      portalConfigured: own ? Boolean(portal) : null,
      billingSuspended: own ? Boolean((await db.query.tenants.findFirst({ where: eq(schema.tenants.id, own) }))?.billingSuspendedAt) : null,
      hostingReady: own ? null : Boolean(hosting.publicIpv4 || hosting.publicIpv6),
      activity,
    };
  });
}

/** The overview of a reseller: only its own customers. */
async function resellerDashboard(resellerId: string) {
  const ids = await tenantIdsOfReseller(resellerId);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const none = ['00000000-0000-0000-0000-000000000000'];
  const inOwn = (col: Parameters<typeof inArray>[0]) => inArray(col, ids.length ? ids : none);
  const [[userCount], [consoleCount], [hostnameCount], [guestCount], activity] = await Promise.all([
    db.select({ value: count() }).from(schema.users).where(or(inOwn(schema.users.tenantId), eq(schema.users.resellerId, resellerId))),
    db.select({ value: count() }).from(schema.consoles).where(inOwn(schema.consoles.tenantId)),
    db.select({ value: count() }).from(schema.hostnames).where(and(eq(schema.hostnames.status, 'active'), inOwn(schema.hostnames.tenantId))),
    db
      .select({ value: count() })
      .from(schema.guestSessions)
      .where(and(eq(schema.guestSessions.status, 'authorized'), gte(schema.guestSessions.authorizedAt, startOfDay), inOwn(schema.guestSessions.tenantId))),
    db
      .select({ id: schema.auditLog.id, action: schema.auditLog.action, details: schema.auditLog.details, createdAt: schema.auditLog.createdAt, userName: schema.users.name })
      .from(schema.auditLog)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.userId))
      .where(or(inOwn(schema.auditLog.tenantId), eq(schema.users.resellerId, resellerId)))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(12),
  ]);
  return {
    tenants: ids.length,
    users: userCount.value,
    consoles: consoleCount.value,
    activeHostnames: hostnameCount.value,
    guestsToday: guestCount.value,
    portalConfigured: null,
    billingSuspended: null,
    hostingReady: null,
    activity,
  };
}
