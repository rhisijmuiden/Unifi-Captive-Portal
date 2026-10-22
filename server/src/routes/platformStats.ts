import { asc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db, schema } from '../db/index.js';
import { normalizeLocale, requestLocale, type Locale } from '../i18n/index.js';
import { requireSuperadmin } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';
import { isUuid } from '../lib/ids.js';
import { renderStatsPdf, reportText, statsCsv } from '../services/platformReport.js';
import { addDays, DAY_RE, daysBetween, MAX_DAYS, platformStats, today, type Granularity, type StatsFilter } from '../services/platformStats.js';

type Query = { from?: string; to?: string; reseller?: string; tenant?: string; granularity?: string; format?: string; lang?: string };

/** Period and selection from the query string; default the last 30 days of all customers. */
export function parseFilter(q: Query, now = new Date()): StatsFilter {
  const to = q.to || today(now);
  const from = q.from || addDays(to, -29);
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw badRequest('errors.dayFormat');
  if (from > to) throw badRequest('errors.periodOrder');
  if (daysBetween(from, to) > MAX_DAYS) throw badRequest('errors.periodTooLong');
  const reseller = q.reseller === 'direct' ? 'direct' : isUuid(q.reseller) ? q.reseller : null;
  const tenantId = isUuid(q.tenant) ? q.tenant : null;
  const granularity = (['day', 'week', 'month'] as const).includes(q.granularity as Granularity) ? (q.granularity as Granularity) : null;
  return { from, to, resellerId: reseller, tenantId, granularity };
}

async function options() {
  const [resellers, tenants] = await Promise.all([
    db.select({ id: schema.resellers.id, name: schema.resellers.name }).from(schema.resellers).orderBy(asc(schema.resellers.name)),
    db.select({ id: schema.tenants.id, name: schema.tenants.name, resellerId: schema.tenants.resellerId }).from(schema.tenants).orderBy(asc(schema.tenants.name)),
  ]);
  return { resellers, tenants };
}

async function scopeLabel(locale: Locale, f: StatsFilter) {
  const { tr } = reportText(locale);
  const { resellers, tenants } = await options();
  const parts = [f.resellerId === 'direct' ? tr('directCustomers') : f.resellerId ? (resellers.find((r) => r.id === f.resellerId)?.name ?? '') : tr('allCustomers')];
  if (f.tenantId) parts.push(tenants.find((t) => t.id === f.tenantId)?.name ?? '');
  return parts.filter(Boolean).join(' › ');
}

/**
 * Statistics across all customers, for the platform admin only. Read-only figures: managing
 * consoles and portals stays in each customer's own environment.
 */
export async function platformStatsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: Query }>('/api/platform/stats', async (req) => {
    requireSuperadmin(req);
    const filter = parseFilter(req.query);
    const [stats, opts] = await Promise.all([platformStats(filter), options()]);
    return { stats, options: opts };
  });

  app.get<{ Querystring: Query }>('/api/platform/stats/export', async (req, reply) => {
    requireSuperadmin(req);
    const filter = parseFilter(req.query);
    const format = req.query.format === 'pdf' ? 'pdf' : 'csv';
    // A download link cannot send the interface language as a header
    const locale = normalizeLocale(req.query.lang) ?? requestLocale(req);
    const [stats, label] = await Promise.all([platformStats(filter), scopeLabel(locale, filter)]);
    const name = `platform-statistics-${filter.from}-${filter.to}.${format}`;
    reply.header('content-disposition', `attachment; filename="${name}"`).header('cache-control', 'no-store');
    if (format === 'pdf') return reply.header('content-type', 'application/pdf').send(await renderStatsPdf(stats, { locale, scopeLabel: label }));
    return reply.header('content-type', 'text/csv; charset=utf-8').send(statsCsv(stats, { locale, scopeLabel: label }));
  });
}
