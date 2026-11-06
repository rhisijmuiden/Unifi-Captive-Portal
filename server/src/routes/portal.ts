import { and, count, desc, eq, gt, gte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit, tenantScope } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { uuidParam } from '../lib/ids.js';
import { getPortalSettings } from '../services/guests.js';
import { formatCode } from '../services/vouchers.js';
import { guestLocales } from '../shared/guestStrings.js';
import { loginMethods, type LoginMethod } from '../shared/portalDesign.js';
import { clearDecision, decide, grantRequestedVisit, listAccessRequests, MAX_APPROVERS } from '../services/accessRequests.js';

export const accessDecisionInput = z.object({ decision: z.enum(['approve', 'reject', 'clear']) });

const texts = z.record(z.string().regex(/^[a-z]{2}$/), z.string().max(5000));

const fieldMode = z.enum(['off', 'optional', 'required']);

export const portalInput = z.object({
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
  auth: z.object({
    methods: z.array(z.enum(loginMethods as [LoginMethod, ...LoginMethod[]])).max(loginMethods.length),
    emailName: fieldMode,
    emailPhone: fieldMode,
    marketingOptIn: z.boolean(),
    welcomeMail: z.boolean(),
    paymentEmail: fieldMode,
    // Defaults keep API clients that predate "Ask for access" working
    approvers: z.array(z.string().trim().toLowerCase().email('errors.emailFormat').max(254)).max(MAX_APPROVERS).default([]),
    approvalRemember: z.boolean().default(true),
  }),
  languages: z.array(z.enum(guestLocales as [string, ...string[]])).min(1).max(guestLocales.length),
});

export async function portalRoutes(app: FastifyInstance) {
  app.get('/api/portal-settings', async (req) => {
    const tenantId = tenantScope(req);
    return { settings: await getPortalSettings(tenantId) };
  });

  app.put('/api/portal-settings', async (req) => {
    const parsed = portalInput.parse(req.body);
    const values = {
      ...parsed,
      languages: [...new Set(parsed.languages)],
      auth: { ...parsed.auth, methods: [...new Set(parsed.auth.methods)], approvers: [...new Set(parsed.auth.approvers)] },
    };
    const tenantId = tenantScope(req, true);
    const [settings] = await db
      .insert(schema.portalSettings)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: schema.portalSettings.tenantId, set: { ...values, updatedAt: new Date() } })
      .returning();
    await audit(req, 'portal.updated', undefined, tenantId);
    return { settings };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/guests', async (req) => {
    const tenantId = tenantScope(req);
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const [sessions, [today], [online]] = await Promise.all([
      db
        .select({ session: schema.guestSessions, siteName: schema.consoleSites.displayName, voucherCode: schema.vouchers.code, packageName: schema.payments.packageName })
        .from(schema.guestSessions)
        .leftJoin(schema.consoleSites, eq(schema.consoleSites.id, schema.guestSessions.consoleSiteId))
        .leftJoin(schema.vouchers, eq(schema.vouchers.id, schema.guestSessions.voucherId))
        .leftJoin(schema.payments, eq(schema.payments.id, schema.guestSessions.paymentId))
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
      guests: sessions.map(({ session: { token: _token, ...s }, siteName, voucherCode, packageName }) => ({ ...s, siteName, voucherCode: voucherCode && formatCode(voucherCode), packageName })),
      stats: { today: today.value, active: online.value },
    };
  });

  // "Ask for access": the requests, newest first; the latest one per device is the one in force
  app.get('/api/access-requests', async (req) => {
    const tenantId = tenantScope(req);
    return { requests: await listAccessRequests(tenantId) };
  });

  /** An admin decides an open request, revokes an approval or unblocks a rejected device. */
  app.post<{ Params: { id: string } }>('/api/access-requests/:id/decision', async (req) => {
    const tenantId = tenantScope(req, true);
    const id = uuidParam(req.params.id);
    const { decision } = accessDecisionInput.parse(req.body);
    const by = req.user?.email ?? (req.apiKey ? `API key ${req.apiKey.name ?? ''}`.trim() : 'admin');
    const owned = await db.query.accessRequests.findFirst({ where: and(eq(schema.accessRequests.id, id), eq(schema.accessRequests.tenantId, tenantId)), columns: { id: true } });
    if (!owned) throw notFound();
    const updated = decision === 'clear' ? await clearDecision(tenantId, id, by) : await decide(id, decision === 'approve' ? 'approved' : 'rejected', by, { allowExpired: true });
    if (!updated) throw badRequest('errors.accessRequestDecided');
    await audit(req, `access.${updated.status}`, { request: updated.id, clientMac: updated.clientMac, via: 'admin' }, tenantId);
    // Approved: connect the device right away when it is still waiting on the network
    const connected = updated.status === 'approved' ? (await grantRequestedVisit(updated)).ok : false;
    return { ok: true, status: updated.status, connected };
  });

  // Removes a guest's personal data (e.g. on request under the GDPR)
  app.delete<{ Params: { id: string } }>('/api/guests/:id', async (req) => {
    const tenantId = tenantScope(req, true);
    const [row] = await db
      .delete(schema.guestSessions)
      .where(and(eq(schema.guestSessions.id, uuidParam(req.params.id)), eq(schema.guestSessions.tenantId, tenantId)))
      .returning({ id: schema.guestSessions.id });
    if (!row) throw notFound();
    await audit(req, 'guest.deleted', undefined, tenantId);
    return { ok: true };
  });
}
