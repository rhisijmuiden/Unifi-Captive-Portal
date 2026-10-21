import { asc, count, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit, requireReseller, requireSuperadmin } from '../lib/auth.js';
import { badRequest, notFound, translateError } from '../lib/errors.js';
import { isValidHostname, normalizeHostname } from '../lib/hostname.js';
import { sentOnly } from '../lib/patch.js';
import { requestLocale } from '../i18n/index.js';
import { adminHostnames, clearHostnameCache } from '../services/hostnames.js';
import { clearResellerCache, publicBrand } from '../services/resellers.js';
import { sendInvite } from '../services/tokens.js';
import { adminInput } from './tenants.js';

const optional = <T extends z.ZodType>(s: T) => s.nullable().optional().or(z.literal('').transform(() => null));
const media = z.string().regex(/^\/portal\/media\/[0-9a-f-]{36}$/, 'errors.imageType');

/** What a reseller may change about its own brand. */
export const brandingInput = z.object({
  brandName: z.string().trim().min(1).max(60),
  logoUrl: optional(media),
  logoDarkUrl: optional(media),
  accentColor: optional(z.string().regex(/^#[0-9a-fA-F]{6}$/, 'errors.colorFormat')),
  websiteUrl: optional(z.string().trim().regex(/^https?:\/\/\S+$/, 'errors.urlFormat').max(200)),
  supportEmail: optional(z.string().trim().toLowerCase().email().max(254)),
});

export const resellerInput = brandingInput.extend({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/, 'errors.slugFormat'),
  contactEmail: optional(z.string().trim().toLowerCase().email()),
  status: z.enum(['active', 'suspended']).default('active'),
  maxTenants: z.coerce.number().int().min(1).max(100_000).nullable().optional(),
  adminHostname: optional(
    z
      .string()
      .transform(normalizeHostname)
      .refine((v) => isValidHostname(v), 'errors.hostnameFormat'),
  ),
  showPoweredBy: z.boolean().default(true),
  showDesignedBy: z.boolean().default(false),
  notes: z.string().max(2000).nullable().optional(),
});

/** An admin hostname must not be the platform's own or any customer's portal hostname. */
async function checkHostname(host: string | null | undefined, resellerId?: string) {
  if (!host) return;
  if ((await adminHostnames()).has(host)) throw badRequest('errors.hostnameTaken');
  if (await db.query.hostnames.findFirst({ where: eq(schema.hostnames.hostname, host), columns: { id: true } })) throw badRequest('errors.hostnameTaken');
  const other = await db.query.resellers.findFirst({ where: eq(schema.resellers.adminHostname, host), columns: { id: true } });
  if (other && other.id !== resellerId) throw badRequest('errors.hostnameTaken');
}

const changed = () => {
  clearResellerCache();
  clearHostnameCache();
};

export async function resellerRoutes(app: FastifyInstance) {
  // ── Platform admin: the resellers themselves ──

  app.get('/api/resellers', async (req) => {
    requireSuperadmin(req);
    const rows = await db.query.resellers.findMany({ orderBy: asc(schema.resellers.name) });
    const tenants = await db.select({ id: schema.tenants.resellerId, n: count() }).from(schema.tenants).groupBy(schema.tenants.resellerId);
    const users = await db.select({ id: schema.users.resellerId, n: count() }).from(schema.users).groupBy(schema.users.resellerId);
    const n = (list: { id: string | null; n: number }[], id: string) => list.find((x) => x.id === id)?.n ?? 0;
    return { resellers: rows.map((r) => ({ ...r, tenantCount: n(tenants, r.id), userCount: n(users, r.id) })) };
  });

  app.post('/api/resellers', async (req) => {
    requireSuperadmin(req);
    const body = resellerInput.parse(req.body);
    const admin = adminInput.parse((req.body as { admin?: unknown } | null)?.admin);
    if (await db.query.resellers.findFirst({ where: eq(schema.resellers.slug, body.slug) })) throw badRequest('errors.slugTaken');
    await checkHostname(body.adminHostname);
    if (admin && (await db.query.users.findFirst({ where: eq(schema.users.email, admin.email) }))) throw badRequest('errors.emailTaken');
    const { reseller, user } = await db.transaction(async (tx) => {
      const [reseller] = await tx.insert(schema.resellers).values(body).returning();
      const [user] = admin
        ? await tx.insert(schema.users).values({ name: admin.name, email: admin.email, role: 'reseller_admin', resellerId: reseller.id, locale: requestLocale(req) }).returning()
        : [null];
      return { reseller, user };
    });
    changed();
    await audit(req, 'reseller.created', { name: reseller.name }, null);
    let inviteError: string | null = null;
    if (user) {
      await audit(req, 'user.created', { email: user.email, role: user.role }, null);
      await sendInvite(user).catch((err: Error) => (inviteError = translateError(err, requestLocale(req))));
    }
    return { reseller, invited: user?.email ?? null, inviteError };
  });

  app.put<{ Params: { id: string } }>('/api/resellers/:id', async (req) => {
    requireSuperadmin(req);
    const body = sentOnly(resellerInput.partial().parse(req.body), req.body);
    if (body.slug) {
      const clash = await db.query.resellers.findFirst({ where: eq(schema.resellers.slug, body.slug), columns: { id: true } });
      if (clash && clash.id !== req.params.id) throw badRequest('errors.slugTaken');
    }
    await checkHostname(body.adminHostname, req.params.id);
    const [reseller] = await db.update(schema.resellers).set(body).where(eq(schema.resellers.id, req.params.id)).returning();
    if (!reseller) throw notFound();
    changed();
    // Suspending closes open sessions of the reseller's team; its customers are refused at their next request
    if (body.status === 'suspended') {
      const team = db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.resellerId, reseller.id));
      await db.delete(schema.sessions).where(inArray(schema.sessions.userId, team));
    }
    await audit(req, 'reseller.updated', { name: reseller.name, changes: Object.keys(body) }, null);
    return { reseller };
  });

  app.delete<{ Params: { id: string } }>('/api/resellers/:id', async (req) => {
    requireSuperadmin(req);
    const [{ value }] = await db.select({ value: count() }).from(schema.tenants).where(eq(schema.tenants.resellerId, req.params.id));
    if (value > 0) throw badRequest('errors.resellerHasTenants', { count: value });
    const [reseller] = await db.delete(schema.resellers).where(eq(schema.resellers.id, req.params.id)).returning();
    if (!reseller) throw notFound();
    changed();
    await audit(req, 'reseller.deleted', { name: reseller.name }, null);
    return { ok: true };
  });

  // ── Reseller admin: its own brand ──

  app.get('/api/reseller', async (req) => {
    const { resellerId } = requireReseller(req);
    const r = await db.query.resellers.findFirst({ where: eq(schema.resellers.id, resellerId) });
    if (!r) throw notFound();
    const [{ value }] = await db.select({ value: count() }).from(schema.tenants).where(eq(schema.tenants.resellerId, resellerId));
    return { reseller: { ...publicBrand(r), companyName: r.name, adminHostname: r.adminHostname, maxTenants: r.maxTenants, tenantCount: value } };
  });

  app.put('/api/reseller/branding', async (req) => {
    const { resellerId } = requireReseller(req);
    const body = sentOnly(brandingInput.partial().parse(req.body), req.body);
    const [r] = await db.update(schema.resellers).set(body).where(eq(schema.resellers.id, resellerId)).returning();
    if (!r) throw notFound();
    changed();
    await audit(req, 'reseller.branding_updated', { changes: Object.keys(body) }, null);
    return { brand: publicBrand(r) };
  });
}
