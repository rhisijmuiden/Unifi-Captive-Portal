import { and, asc, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import type { FastifyRequest } from 'fastify';
import type { User } from '../db/schema.js';
import { audit, publicUser, requireTenantAdmin, requireTenantManager, requireUser } from '../lib/auth.js';
import { sentOnly } from '../lib/patch.js';
import { badRequest, forbidden, notFound, translateError } from '../lib/errors.js';
import { requestLocale } from '../i18n/index.js';
import { sendInvite, sendPasswordReset, setGeneratedPassword } from '../services/tokens.js';
import { disableTwoFactor } from '../services/twoFactor.js';

export const userInput = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['superadmin', 'tenant_admin', 'tenant_user', 'reseller_admin']),
  tenantId: z.string().uuid().nullable().optional(),
  resellerId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().default(true),
  sendInvite: z.boolean().default(true),
  // invite = e-mail to choose a password, generate = login details shown once to pass on, none = no e-mail (e.g. Microsoft sign-in)
  credentials: z.enum(['invite', 'generate', 'none']).optional(),
  mustChangePassword: z.boolean().default(true),
});

/** Fields that only apply when a user is added. */
export const userUpdateInput = userInput.omit({ sendInvite: true, credentials: true, mustChangePassword: true }).partial();

/**
 * Who may manage this user: platform admins everyone; reseller admins their own team and the
 * people of their customers; customer admins their own team.
 */
async function requireUserManager(req: FastifyRequest, target: User) {
  const me = requireUser(req);
  if (me.role === 'superadmin') return me;
  if (target.role === 'superadmin') throw forbidden();
  if (me.role === 'reseller_admin') {
    if (target.resellerId) {
      if (target.resellerId !== me.resellerId) throw forbidden();
      return me;
    }
    if (!target.tenantId) throw forbidden();
    return requireTenantManager(req, target.tenantId);
  }
  if (target.role === 'reseller_admin') throw forbidden();
  return requireTenantAdmin(req, target.tenantId);
}

export async function userRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { tenantId?: string; resellerId?: string } }>('/api/users', async (req) => {
    const me = requireUser(req);
    let where;
    if (me.role === 'superadmin') {
      where = req.query.tenantId ? eq(schema.users.tenantId, req.query.tenantId) : req.query.resellerId ? eq(schema.users.resellerId, req.query.resellerId) : undefined;
    }
    else if (me.role === 'reseller_admin') {
      // The reseller's own team, or the team of one of its customers
      if (req.query.tenantId) {
        await requireTenantManager(req, req.query.tenantId);
        where = eq(schema.users.tenantId, req.query.tenantId);
      } else where = eq(schema.users.resellerId, me.resellerId!);
    } else {
      requireTenantAdmin(req, me.tenantId);
      where = eq(schema.users.tenantId, me.tenantId!);
    }
    const rows = await db.query.users.findMany({ where, orderBy: asc(schema.users.name) });
    return { users: rows.map(publicUser) };
  });

  app.post('/api/users', async (req) => {
    const me = requireUser(req);
    const body = userInput.parse(req.body);
    if (body.role === 'superadmin') {
      if (me.role !== 'superadmin') throw forbidden();
      body.tenantId = null;
      body.resellerId = null;
    } else if (body.role === 'reseller_admin') {
      if (me.role === 'reseller_admin') body.resellerId = me.resellerId;
      else if (me.role !== 'superadmin') throw forbidden();
      if (!body.resellerId) throw badRequest('errors.chooseReseller');
      body.tenantId = null;
    } else {
      // Customer admins only add people to their own company
      if (me.role !== 'superadmin' && me.role !== 'reseller_admin') body.tenantId = me.tenantId;
      if (!body.tenantId) throw badRequest('errors.chooseTenant');
      if (me.role === 'reseller_admin') await requireTenantManager(req, body.tenantId);
      else requireTenantAdmin(req, body.tenantId);
      body.resellerId = null;
    }
    if (await db.query.users.findFirst({ where: eq(schema.users.email, body.email) })) {
      throw badRequest('errors.emailTaken');
    }
    const [user] = await db
      .insert(schema.users)
      // New users start in the language of the person inviting them
      .values({ name: body.name, email: body.email, role: body.role, tenantId: body.tenantId, resellerId: body.resellerId, isActive: body.isActive, locale: requestLocale(req) })
      .returning();
    await audit(req, 'user.created', { email: user.email, role: user.role }, user.tenantId);
    const how = body.credentials ?? (body.sendInvite ? 'invite' : 'none');
    if (how === 'generate') {
      const credentials = await setGeneratedPassword(user, body.mustChangePassword);
      await audit(req, 'user.password_generated', { email: user.email }, user.tenantId);
      const fresh = await db.query.users.findFirst({ where: eq(schema.users.id, user.id) });
      return { user: publicUser(fresh ?? user), inviteError: null, credentials };
    }
    let inviteError: string | null = null;
    if (how === 'invite') await sendInvite(user).catch((err: Error) => (inviteError = translateError(err, requestLocale(req))));
    return { user: publicUser(user), inviteError, credentials: null };
  });

  app.put<{ Params: { id: string } }>('/api/users/:id', async (req) => {
    const target = await db.query.users.findFirst({ where: eq(schema.users.id, req.params.id) });
    if (!target) throw notFound();
    const me = await requireUserManager(req, target);
    const body = sentOnly(userUpdateInput.parse(req.body), req.body);
    if (me.role !== 'superadmin') {
      // Nobody but the platform admin moves people between companies or resellers
      delete body.tenantId;
      delete body.resellerId;
      if (body.role === 'superadmin') throw forbidden();
      // A role change stays on the same side: reseller team or customer team
      if (body.role && (body.role === 'reseller_admin') !== (target.role === 'reseller_admin')) throw forbidden();
    }
    if (target.id === me.id && (body.isActive === false || (body.role && body.role !== me.role))) {
      throw badRequest('errors.ownRole');
    }
    if (body.role === 'superadmin') Object.assign(body, { tenantId: null, resellerId: null });
    else if (body.role === 'reseller_admin') {
      body.tenantId = null;
      if (!(body.resellerId ?? target.resellerId)) throw badRequest('errors.chooseReseller');
    } else if (body.role) {
      body.resellerId = null;
      if (!(body.tenantId ?? target.tenantId)) throw badRequest('errors.chooseTenant');
    }
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
    await requireUserManager(req, target);
    await sendInvite(target);
    await audit(req, 'user.invited', { email: target.email }, target.tenantId);
    return { ok: true };
  });

  // Password reset by e-mail; someone who never chose a password gets a fresh invitation instead
  app.post<{ Params: { id: string } }>('/api/users/:id/reset-mail', async (req) => {
    const target = await db.query.users.findFirst({ where: eq(schema.users.id, req.params.id) });
    if (!target) throw notFound();
    const me = await requireUserManager(req, target);
    if (target.id === me.id) throw badRequest('errors.ownPassword');
    if (!target.isActive) throw badRequest('errors.userInactive');
    const kind = target.passwordHash ? 'reset' : 'invite';
    if (kind === 'reset') await sendPasswordReset(target);
    else await sendInvite(target);
    await audit(req, kind === 'reset' ? 'user.password_reset_sent' : 'user.invited', { email: target.email }, target.tenantId);
    return { ok: true, kind };
  });

  // New login details to pass on when someone cannot use the e-mail link; signs them out everywhere
  app.post<{ Params: { id: string } }>('/api/users/:id/password', async (req) => {
    const target = await db.query.users.findFirst({ where: eq(schema.users.id, req.params.id) });
    if (!target) throw notFound();
    const me = await requireUserManager(req, target);
    if (target.id === me.id) throw badRequest('errors.ownPassword');
    const { mustChangePassword } = z.object({ mustChangePassword: z.boolean().default(true) }).parse(req.body ?? {});
    const credentials = await setGeneratedPassword(target, mustChangePassword);
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, target.id));
    await audit(req, 'user.password_generated', { email: target.email }, target.tenantId);
    return { credentials };
  });

  // For a team member who lost their phone and their recovery codes; they set it up again at the next sign-in
  app.post<{ Params: { id: string } }>('/api/users/:id/reset-2fa', async (req) => {
    const target = await db.query.users.findFirst({ where: eq(schema.users.id, req.params.id) });
    if (!target) throw notFound();
    const me = await requireUserManager(req, target);
    if (target.id === me.id) throw badRequest('errors.ownTwoFactor');
    await disableTwoFactor(target.id);
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, target.id));
    await audit(req, 'user.2fa_reset', { email: target.email }, target.tenantId);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/users/:id', async (req) => {
    const target = await db.query.users.findFirst({ where: eq(schema.users.id, req.params.id) });
    if (!target) throw notFound();
    const me = await requireUserManager(req, target);
    if (target.id === me.id) throw badRequest('errors.deleteSelf');
    await db.delete(schema.users).where(eq(schema.users.id, target.id));
    await audit(req, 'user.deleted', { email: target.email }, target.tenantId);
    return { ok: true };
  });
}
