import { count, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit, requireSuperadmin, requireTenantAdmin } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';

const tenantInput = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/, 'Gebruik kleine letters, cijfers en streepjes'),
  contactEmail: z.string().email().nullable().optional().or(z.literal('').transform(() => null)),
  status: z.enum(['active', 'suspended']).default('active'),
  notes: z.string().max(2000).nullable().optional(),
});

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
    const exists = await db.query.tenants.findFirst({ where: eq(schema.tenants.slug, body.slug) });
    if (exists) throw badRequest('Deze korte naam is al in gebruik');
    const [tenant] = await db.insert(schema.tenants).values(body).returning();
    await audit(req, 'tenant.created', { name: tenant.name }, tenant.id);
    return { tenant };
  });

  app.put<{ Params: { id: string } }>('/api/tenants/:id', async (req) => {
    requireSuperadmin(req);
    const body = tenantInput.partial().parse(req.body);
    const [tenant] = await db.update(schema.tenants).set(body).where(eq(schema.tenants.id, req.params.id)).returning();
    if (!tenant) throw notFound();
    await audit(req, 'tenant.updated', body, tenant.id);
    return { tenant };
  });

  app.delete<{ Params: { id: string } }>('/api/tenants/:id', async (req) => {
    requireSuperadmin(req);
    const [tenant] = await db.delete(schema.tenants).where(eq(schema.tenants.id, req.params.id)).returning();
    if (!tenant) throw notFound();
    await audit(req, 'tenant.deleted', { name: tenant.name }, null);
    return { ok: true };
  });
}
