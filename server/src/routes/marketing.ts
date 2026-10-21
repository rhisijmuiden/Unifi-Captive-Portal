import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit, tenantScope } from '../lib/auth.js';
import { sentOnly } from '../lib/patch.js';
import { adminForget, privacyRequests, providerReady, syncContacts, testMarketing } from '../services/marketing.js';
import { getPublicTenantSettings, getTenantSettings, marketingSettingsSchema, saveTenantSettings, surveySettingsSchema } from '../services/tenantSettings.js';

export const csvCell = (v: unknown) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  // Quoted, and formulas neutralised for spreadsheet programs
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

export async function marketingRoutes(app: FastifyInstance) {
  app.get('/api/marketing-settings', async (req) => {
    const tenantId = tenantScope(req);
    const m = await getTenantSettings(tenantId, 'marketing');
    return { settings: await getPublicTenantSettings(tenantId, 'marketing'), ready: providerReady(m) };
  });

  app.put('/api/marketing-settings', async (req) => {
    const tenantId = tenantScope(req, true);
    const input = sentOnly(marketingSettingsSchema.partial().passthrough().parse(req.body), req.body) as Record<string, unknown>;
    await saveTenantSettings(tenantId, 'marketing', input);
    await audit(req, 'marketing.updated', { provider: input.provider }, tenantId);
    const m = await getTenantSettings(tenantId, 'marketing');
    return { settings: await getPublicTenantSettings(tenantId, 'marketing'), ready: providerReady(m) };
  });

  app.post('/api/marketing-settings/test', async (req) => {
    const tenantId = tenantScope(req, true);
    const stored = await getTenantSettings(tenantId, 'marketing');
    const filled = Object.fromEntries(Object.entries((req.body ?? {}) as Record<string, unknown>).filter(([, v]) => (typeof v === 'string' ? v.trim() !== '' : v !== undefined)));
    return testMarketing(marketingSettingsSchema.parse({ ...stored, ...filled }));
  });

  app.post('/api/marketing/sync', async (req) => {
    const tenantId = tenantScope(req, true);
    const result = await syncContacts(tenantId);
    await audit(req, 'marketing.synced', result, tenantId);
    return result;
  });

  /** Contacts: everyone who signed in with an e-mail address, newest visit first. */
  app.get<{ Querystring: { optIn?: string; format?: string } }>('/api/marketing/contacts', async (req, reply) => {
    const tenantId = tenantScope(req);
    const c = schema.guestContacts;
    const onlyOptIn = req.query.optIn === '1' || req.query.optIn === 'true';
    const rows = await db.query.guestContacts.findMany({ where: and(eq(c.tenantId, tenantId), onlyOptIn ? eq(c.optIn, true) : undefined), orderBy: [desc(c.lastSeenAt)], limit: 20_000 });
    const [counts] = await db
      .select({ total: sql<number>`count(*)::int`, optIn: sql<number>`count(*) filter (where ${c.optIn})::int`, synced: sql<number>`count(*) filter (where ${c.optIn} and ${c.syncedAt} is not null and ${c.syncedAt} >= ${c.updatedAt})::int`, failed: sql<number>`count(*) filter (where ${c.syncError} is not null)::int` })
      .from(c)
      .where(eq(c.tenantId, tenantId));
    if (req.query.format === 'csv') {
      await audit(req, 'marketing.exported', { count: rows.length, optIn: onlyOptIn }, tenantId);
      const head = ['email', 'name', 'phone', 'language', 'opt_in', 'opt_in_at', 'source', 'visits', 'first_seen', 'last_seen'];
      const body = rows.map((r) => [r.email, r.name, r.phone, r.locale, r.optIn ? 'yes' : 'no', r.optInAt, r.source, r.visits, r.firstSeenAt, r.lastSeenAt].map(csvCell).join(','));
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="contacts${onlyOptIn ? '-opt-in' : ''}.csv"`)
        .send(`﻿${[head.join(','), ...body].join('\r\n')}\r\n`);
    }
    return { contacts: rows.slice(0, 500), counts };
  });

  /** Erases everything about one e-mail address, as a guest's request would. */
  app.post('/api/marketing/forget', async (req) => {
    const tenantId = tenantScope(req, true);
    const { email } = z.object({ email: z.string().trim().email().max(254) }).parse(req.body);
    const result = await adminForget(tenantId, email);
    await audit(req, 'privacy.erased', { sessions: result.sessions, via: 'admin', providerError: result.providerError }, tenantId);
    return result;
  });

  app.get('/api/marketing/privacy-requests', async (req) => {
    const tenantId = tenantScope(req);
    return { requests: await privacyRequests(tenantId) };
  });

  // ── Survey ──

  app.get('/api/survey-settings', async (req) => {
    const tenantId = tenantScope(req);
    return { settings: await getPublicTenantSettings(tenantId, 'survey') };
  });

  app.put('/api/survey-settings', async (req) => {
    const tenantId = tenantScope(req, true);
    const input = sentOnly(surveySettingsSchema.partial().parse(req.body), req.body);
    await saveTenantSettings(tenantId, 'survey', input);
    await audit(req, 'survey.updated', undefined, tenantId);
    return { settings: await getPublicTenantSettings(tenantId, 'survey') };
  });

  /** Average, distribution per star, per week, and the latest comments. */
  app.get<{ Querystring: { days?: string } }>('/api/survey', async (req) => {
    const tenantId = tenantScope(req);
    const days = z.coerce.number().int().min(1).max(3650).catch(90).parse(req.query.days ?? 90);
    const r = schema.surveyResponses;
    const since = sql`now() - make_interval(days => ${days})`;
    const where = and(eq(r.tenantId, tenantId), sql`${r.createdAt} >= ${since}`);
    const [sum] = await db.select({ count: sql<number>`count(*)::int`, average: sql<number | null>`round(avg(${r.rating})::numeric, 2)::float` }).from(r).where(where);
    const dist = await db.select({ rating: r.rating, count: sql<number>`count(*)::int` }).from(r).where(where).groupBy(r.rating);
    const weeks = await db
      .select({ week: sql<string>`to_char(date_trunc('week', ${r.createdAt}), 'YYYY-MM-DD')`, count: sql<number>`count(*)::int`, average: sql<number>`round(avg(${r.rating})::numeric, 2)::float` })
      .from(r)
      .where(where)
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    const comments = await db.query.surveyResponses.findMany({ where: and(where, sql`${r.comment} is not null`), orderBy: [desc(r.createdAt)], limit: 100, columns: { id: true, rating: true, comment: true, locale: true, createdAt: true } });
    const byStar = [1, 2, 3, 4, 5].map((n) => ({ rating: n, count: dist.find((d) => d.rating === n)?.count ?? 0 }));
    return { days, count: sum?.count ?? 0, average: sum?.average ?? null, byStar, weeks, comments };
  });
}
