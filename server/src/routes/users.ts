import { and, asc, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit, publicUser, requireTenantAdmin, requireUser } from '../lib/auth.js';
import { sentOnly } from '../lib/patch.js';
import { badRequest, forbidden, notFound, translateError } from '../lib/errors.js';
import { requestLocale } from '../i18n/index.js';
import { sendInvite } from '../services/tokens.js';
import { disableTwoFactor } from '../services/twoFactor.js';

export const userInput = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['superadmin', 'tenant_admin', 'tenant_user']),
  tenantId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().default(true),
  sendInvite: z.boolean().default(true),
});

export async function userRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { tenantId?: string } }>('/api/users', async (req) => {
    const me = requireUser(req);
    const tenantId = me.role === 'superadmin' ? req.query.tenantId : me.tenantId!;
    requireTenantAdmin(req, tenantId ?? undefined);
    const rows = await db.query.users.findMany({
      where: tenantId ? eq(schema.users.tenantId, tenantId) : undefined,
      orderBy: asc(schema.users.name),
    });
    return { users: rows.map(publicUser) };
  });

  app.post('/api/users', async (req) => {
    const me = requireUser(req);
    const body = userInput.parse(req.body);
    if (me.role !== 'superadmin') {
      // Tenant admins can only add people to their own company, never platform admins
      if (body.role === 'superadmin') throw forbidden();
      body.tenantId = me.tenantId;
    }
    requireTenantAdmin(req, body.tenantId ?? null);
    if (body.role === 'superadmin') body.tenantId = null;
    else if (!body.tenantId) throw badRequest('errors.chooseTenant');
    if (await db.query.users.findFirst({ where: eq(schema.users.email, body.email) })) {
      throw badRequest('errors.emailTaken');
    }
    const [user] = await db
      .insert(schema.users)
      // New users start in the language of the person inviting them
      .values({ name: body.name, email: body.email, role: body.role, tenantId: body.tenantId, isActive: body.isActive, locale: requestLocale(req) })
      .returning();
    await audit(req, 'user.created', { email: user.email, role: user.role }, user.tenantId);
    let inviteError: string | null = null;
    if (body.sendInvite) await sendInvite(user).catch((err: Error) => (inviteError = translateError(err, requestLocale(req))));
    return { user: publicUser(user), inviteError };
  });

  app.put<{ Params: { id: string } }>('/api/users/:id', async (req) => {
    const me = requireUser(req);
    const target = await db.query.users.findFirst({ where: eq(schema.users.id, req.params.id) });
    if (!target) throw notFound();
    requireTenantAdmin(req, target.tenantId);
    const body = sentOnly(userInput.omit({ sendInvite: true }).partial().parse(req.body), req.body);
    if (me.role !== 'superadmin') {
      if (body.role === 'superadmin' || target.role === 'superadmin') throw forbidden();
      delete body.tenantId;
    }
    if (target.id === me.id && (body.isActive === false || (body.role && body.role !== me.role))) {
      throw badRequest('errors.ownRole');
    }
    if (body.role === 'superadmin') body.tenantId = null;
    if (body.email && body.email !== target.email) {
      const clash = await db.query.users.findFirst({ where: and(eq(schema.users.email, body.email), ne(schema.users.id, target.id)) });
      if (clash) throw badRequest('errors.emailTaken');
    }
    const [user] = await db.update(schema.users).set(body).where(eq(schema.users.id, target.id)).returning();
    if (body.isActive === false) await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    await audit(req, 'user.updated', { email: user.email, changes: Object.keys(body) }, user.tenantId);
    return { user: publicUser(user) };
  });

  app.post<{ Params: { id: string } }>('/api/users/:id/invite', async (req) => {
    const target = await db.query.users.findFirst({ where: eq(schema.users.id, req.params.id) });
    if (!target) throw notFound();
    requireTenantAdmin(req, target.tenantId);
    await sendInvite(target);
    await audit(req, 'user.invited', { email: target.email }, target.tenantId);
    return { ok: true };
  });

  // For a team member who lost their phone and their recovery codes; they set it up again at the next sign-in
  app.post<{ Params: { id: string } }>('/api/users/:id/reset-2fa', async (req) => {
    const me = requireUser(req);
    const target = await db.query.users.findFirst({ where: eq(schema.users.id, req.params.id) });
    if (!target) throw notFound();
    requireTenantAdmin(req, target.tenantId);
    if (target.role === 'superadmin' && me.role !== 'superadmin') throw forbidden();
    if (target.id === me.id) throw badRequest('errors.ownTwoFactor');
    await disableTwoFactor(target.id);
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, target.id));
    await audit(req, 'user.2fa_reset', { email: target.email }, target.tenantId);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/users/:id', async (req) => {
    const me = requireUser(req);
    const target = await db.query.users.findFirst({ where: eq(schema.users.id, req.params.id) });
    if (!target) throw notFound();
    requireTenantAdmin(req, target.tenantId);
    if (target.id === me.id) throw badRequest('errors.deleteSelf');
    if (target.role === 'superadmin' && me.role !== 'superadmin') throw forbidden();
    await db.delete(schema.users).where(eq(schema.users.id, target.id));
    await audit(req, 'user.deleted', { email: target.email }, target.tenantId);
    return { ok: true };
  });
}
