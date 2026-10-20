import { count, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit, requireSuperadmin, requireTenantAdmin } from '../lib/auth.js';
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
});

// Optional first administrator, invited by e-mail right away
export const adminInput = z
  .object({ name: z.string().trim().min(1).max(120), email: z.string().trim().toLowerCase().email() })
  .nullable()
  .optional();

export async function tenantRoutes(app: FastifyInstance) {
  app.get('/api/tenants', async (req) => {
    requireSuperadmin(req);
    const rows = await db
      .select({ tenant: schema.tenants, users: count(schema.users.id) })
      .from(schema.tenants)
      .leftJoin(schema.users, eq(schema.users.tenantId, schema.tenants.id))
      .groupBy(schema.tenants.id)
      .orderBy(desc(schema.tenants.createdAt));
    return { tenants: rows.map((r) => ({ ...r.tenant, userCount: r.users })) };
  });

  app.get<{ Params: { id: string } }>('/api/tenants/:id', async (req) => {
    requireTenantAdmin(req, req.params.id);
    const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, req.params.id) });
    if (!tenant) throw notFound();
    return { tenant };
  });

  app.post('/api/tenants', async (req) => {
    requireSuperadmin(req);
    const body = tenantInput.parse(req.body);
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
    await audit(req, 'tenant.created', { name: tenant.name }, tenant.id);
    emit(null, 'tenant.created', { tenant, admin: user?.email ?? null });
    let inviteError: string | null = null;
    if (user) {
      await audit(req, 'user.created', { email: user.email, role: user.role }, tenant.id);
      await sendInvite(user).catch((err: Error) => (inviteError = translateError(err, requestLocale(req))));
    }
    return { tenant, invited: user?.email ?? null, inviteError };
  });

  app.put<{ Params: { id: string } }>('/api/tenants/:id', async (req) => {
    requireSuperadmin(req);
    const body = tenantInput.partial().parse(req.body);
    const [tenant] = await db.update(schema.tenants).set(body).where(eq(schema.tenants.id, req.params.id)).returning();
    if (!tenant) throw notFound();
    await audit(req, 'tenant.updated', body, tenant.id);
    emit(null, 'tenant.updated', { tenant, changes: Object.keys(body) });
    return { tenant };
  });

  app.delete<{ Params: { id: string } }>('/api/tenants/:id', async (req) => {
    requireSuperadmin(req);
    const [tenant] = await db.delete(schema.tenants).where(eq(schema.tenants.id, req.params.id)).returning();
    if (!tenant) throw notFound();
    await audit(req, 'tenant.deleted', { name: tenant.name }, null);
    emit(null, 'tenant.deleted', { id: tenant.id, name: tenant.name, slug: tenant.slug });
    return { ok: true };
  });
}
