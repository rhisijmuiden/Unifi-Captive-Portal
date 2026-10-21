import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db, schema } from '../db/index.js';
import { normalizeLocale, requestLocale } from '../i18n/index.js';
import { audit, requireUser, tenantScope } from '../lib/auth.js';
import { sentOnly } from '../lib/patch.js';
import { badRequest, translateError } from '../lib/errors.js';
import { sendMonthlyReport, tenantRecipients } from '../services/notifications.js';
import { monthlyStats, MONTH_RE, previousMonth } from '../services/reports.js';
import { getPublicTenantSettings, notificationSettingsSchema, saveTenantSettings } from '../services/tenantSettings.js';

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/api/notification-settings', async (req) => {
    const tenantId = tenantScope(req);
    const [settings, log, recipients] = await Promise.all([
      getPublicTenantSettings(tenantId, 'notifications'),
      db.query.notificationLog.findMany({ where: eq(schema.notificationLog.tenantId, tenantId), orderBy: desc(schema.notificationLog.createdAt), limit: 50 }),
      tenantRecipients(tenantId),
    ]);
    return { settings, log, recipients: recipients.map((r) => r.email) };
  });

  app.put('/api/notification-settings', async (req) => {
    const tenantId = tenantScope(req, true);
    const input = sentOnly(notificationSettingsSchema.partial().parse(req.body), req.body);
    await saveTenantSettings(tenantId, 'notifications', input);
    await audit(req, 'notifications.updated', undefined, tenantId);
    return { settings: await getPublicTenantSettings(tenantId, 'notifications') };
  });

  app.get<{ Querystring: { month?: string } }>('/api/reports/monthly', async (req) => {
    const tenantId = tenantScope(req);
    const month = req.query.month ?? previousMonth();
    if (!MONTH_RE.test(month)) throw badRequest('errors.monthFormat');
    return { report: await monthlyStats(tenantId, month) };
  });

  // Sends the report of a month to the signed-in user, e.g. to see what customers receive
  app.post<{ Querystring: { month?: string } }>('/api/reports/monthly/send', async (req) => {
    const tenantId = tenantScope(req, true);
    const user = requireUser(req);
    const month = req.query.month ?? previousMonth();
    if (!MONTH_RE.test(month)) throw badRequest('errors.monthFormat');
    try {
      await sendMonthlyReport(tenantId, month, { to: { email: user.email, locale: normalizeLocale(user.locale) ?? requestLocale(req) } });
      return { ok: true, to: user.email };
    } catch (err) {
      return { ok: false, error: translateError(err, requestLocale(req)) };
    }
  });
}
