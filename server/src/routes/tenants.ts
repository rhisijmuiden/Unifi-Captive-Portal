import { and, count, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit, requireTenantAdmin, requireTenantManager, requireUser } from '../lib/auth.js';
import { forbidden } from '../lib/errors.js';
import { clearResellerCache } from '../services/resellers.js';
import { sentOnly } from '../lib/patch.js';
import { badRequest, notFound, translateError } from '../lib/errors.js';
import { requestLocale } from '../i18n/index.js';
import { sendInvite } from '../services/tokens.js';
import { emit } from '../services/webhooks.js';

export const tenantInput = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/, 'errors.slugFormat'),
  contactEmail: z.string().email().nullable().optional().or(z.literal('').transform(() => null)),
  status: z.enum(['active', 'suspended']).default('active'),
  notes: z.string().max(2000).nullable().optional(),
  // Only the platform admin assigns customers to a reseller
  resellerId: z.string().uuid().nullable().optional(),
});

// Optional first administrator, invited by e-mail right away
export const adminInput = z
  .object({ name: z.string().trim().min(1).max(120), email: z.string().trim().toLowerCase().email() })
  .nullable()
  .optional();

/** Platform admins see every customer, reseller admins only their own. */
function listScope(req: FastifyRequest) {
  const user = requireUser(req);
  if (user.role === 'superadmin') return { user, resellerId: null as string | null };
  if (user.role === 'reseller_admin' && user.resellerId) return { user, resellerId: user.resellerId };
  throw forbidden();
}

export async function tenantRoutes(app: FastifyInstance) {
  app.get('/api/tenants', async (req) => {
    const { resellerId } = listScope(req);
    const rows = await db
      .select({ tenant: schema.tenants, users: count(schema.users.id), resellerName: schema.resellers.name })
      .from(schema.tenants)
      .leftJoin(schema.users, eq(schema.users.tenantId, schema.tenants.id))
      .leftJoin(schema.resellers, eq(schema.resellers.id, schema.tenants.resellerId))
      .where(resellerId ? eq(schema.tenants.resellerId, resellerId) : undefined)
      .groupBy(schema.tenants.id, schema.resellers.name)
      .orderBy(desc(schema.tenants.createdAt));
    return { tenants: rows.map((r) => ({ ...r.tenant, userCount: r.users, resellerName: r.resellerName })) };
  });

  app.get<{ Params: { id: string } }>('/api/tenants/:id', async (req) => {
    const user = requireUser(req);
    if (user.role === 'reseller_admin') await requireTenantManager(req, req.params.id);
    else requireTenantAdmin(req, req.params.id);
    const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, req.params.id) });
    if (!tenant) throw notFound();
    return { tenant };
  });

  app.post('/api/tenants', async (req) => {
    const { resellerId: own } = listScope(req);
    const body = tenantInput.parse(req.body);
    if (own) {
      body.resellerId = own;
      const reseller = await db.query.resellers.findFirst({ where: eq(schema.resellers.id, own) });
      if (reseller?.maxTenants != null) {
        const [{ value }] = await db.select({ value: count() }).from(schema.tenants).where(eq(schema.tenants.resellerId, own));
        if (value >= reseller.maxTenants) throw badRequest('errors.resellerLimit', { max: reseller.maxTenants });
      }
    } else if (body.resellerId && !(await db.query.resellers.findFirst({ where: eq(schema.resellers.id, body.resellerId) }))) {
      throw badRequest('errors.resellerUnknown');
    }
    const admin = adminInput.parse((req.body as { admin?: unknown } | null)?.admin);
    const exists = await db.query.tenants.findFirst({ where: eq(schema.tenants.slug, body.slug) });
    if (exists) throw badRequest('errors.slugTaken');
    if (admin && (await db.query.users.findFirst({ where: eq(schema.users.email, admin.email) }))) throw badRequest('errors.emailTaken');
    const { tenant, user } = await db.transaction(async (tx) => {
      const [tenant] = await tx.insert(schema.tenants).values(body).returning();
      const [user] = admin
        ? await tx.insert(schema.users).values({ name: admin.name, email: admin.email, role: 'tenant_admin', tenantId: tenant.id, locale: requestLocale(req) }).returning()
        : [null];
      return { tenant, user };
    });
    await audit(req, 'tenant.created', { name: tenant.name, resellerId: tenant.resellerId }, tenant.id);
    emit(null, 'tenant.created', { tenant, admin: user?.email ?? null });
    let inviteError: string | null = null;
    if (user) {
      await audit(req, 'user.created', { email: user.email, role: user.role }, tenant.id);
      await sendInvite(user).catch((err: Error) => (inviteError = translateError(err, requestLocale(req))));
    }
    return { tenant, invited: user?.email ?? null, inviteError };
  });

  app.put<{ Params: { id: string } }>('/api/tenants/:id', async (req) => {
    const me = await requireTenantManager(req, req.params.id);
    const body = sentOnly(tenantInput.partial().parse(req.body), req.body);
    if (me.role !== 'superadmin') delete body.resellerId;
    else if (body.resellerId && !(await db.query.resellers.findFirst({ where: eq(schema.resellers.id, body.resellerId) }))) throw badRequest('errors.resellerUnknown');
    const [tenant] = await db.update(schema.tenants).set(body).where(eq(schema.tenants.id, req.params.id)).returning();
    if (!tenant) throw notFound();
    if ('resellerId' in body) clearResellerCache();
    await audit(req, 'tenant.updated', body, tenant.id);
    emit(null, 'tenant.updated', { tenant, changes: Object.keys(body) });
    return { tenant };
  });

  app.delete<{ Params: { id: string } }>('/api/tenants/:id', async (req) => {
    const me = await requireTenantManager(req, req.params.id);
    const own = me.role === 'superadmin' ? undefined : eq(schema.tenants.resellerId, me.resellerId!);
    const [tenant] = await db.delete(schema.tenants).where(and(eq(schema.tenants.id, req.params.id), own)).returning();
    if (!tenant) throw notFound();
    await audit(req, 'tenant.deleted', { name: tenant.name }, null);
    emit(null, 'tenant.deleted', { id: tenant.id, name: tenant.name, slug: tenant.slug });
    return { ok: true };
  });
}
