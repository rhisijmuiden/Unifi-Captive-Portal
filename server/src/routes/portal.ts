import { and, count, desc, eq, gt, gte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit, tenantScope } from '../lib/auth.js';
import { getPortalSettings } from '../services/guests.js';

const texts = z.record(z.string().regex(/^[a-z]{2}$/), z.string().max(5000));

const portalInput = z.object({
  title: texts,
  welcome: texts,
  terms: texts,
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'errors.colorFormat'),
  requireTerms: z.boolean(),
  timeLimitMinutes: z.coerce.number().int().min(5).max(525_600),
  dataLimitMb: z.coerce.number().int().min(1).max(1_048_576).nullable(),
  downKbps: z.coerce.number().int().min(64).max(10_000_000).nullable(),
  upKbps: z.coerce.number().int().min(64).max(10_000_000).nullable(),
  successUrl: z
    .string()
    .trim()
    .regex(/^https?:\/\/\S+$/, 'errors.urlFormat')
    .nullable()
    .or(z.literal('').transform(() => null)),
});

export async function portalRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { tenantId?: string } }>('/api/portal-settings', async (req) => {
    const tenantId = tenantScope(req, req.query.tenantId);
    return { settings: await getPortalSettings(tenantId) };
  });

  app.put('/api/portal-settings', async (req) => {
    const body = portalInput.extend({ tenantId: z.string().optional() }).parse(req.body);
    const tenantId = tenantScope(req, body.tenantId, true);
    const { tenantId: _t, ...values } = body;
    const [settings] = await db
      .insert(schema.portalSettings)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: schema.portalSettings.tenantId, set: { ...values, updatedAt: new Date() } })
      .returning();
    await audit(req, 'portal.updated', undefined, tenantId);
    return { settings };
  });

  app.get<{ Querystring: { tenantId?: string; limit?: string } }>('/api/guests', async (req) => {
    const tenantId = tenantScope(req, req.query.tenantId);
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const [sessions, [today], [online]] = await Promise.all([
      db
        .select({ session: schema.guestSessions, siteName: schema.consoleSites.displayName })
        .from(schema.guestSessions)
        .leftJoin(schema.consoleSites, eq(schema.consoleSites.id, schema.guestSessions.consoleSiteId))
        .where(eq(schema.guestSessions.tenantId, tenantId))
        .orderBy(desc(schema.guestSessions.createdAt))
        .limit(limit),
      db
        .select({ value: count() })
        .from(schema.guestSessions)
        .where(and(eq(schema.guestSessions.tenantId, tenantId), eq(schema.guestSessions.status, 'authorized'), gte(schema.guestSessions.authorizedAt, startOfDay))),
      db
        .select({ value: count() })
        .from(schema.guestSessions)
        .where(and(eq(schema.guestSessions.tenantId, tenantId), eq(schema.guestSessions.status, 'authorized'), gt(schema.guestSessions.accessUntil, now))),
    ]);
    return {
      guests: sessions.map(({ session: { token: _token, ...s }, siteName }) => ({ ...s, siteName })),
      stats: { today: today.value, active: online.value },
    };
  });
}
