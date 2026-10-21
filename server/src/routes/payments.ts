import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit, tenantScope } from '../lib/auth.js';
import { sentOnly } from '../lib/patch.js';
import { notFound } from '../lib/errors.js';
import { uuidParam } from '../lib/ids.js';
import { testProvider } from '../services/payments.js';
import { tenantPortalOrigin } from '../services/hostnames.js';
import { adminBaseUrl } from '../services/settings.js';
import { getPublicTenantSettings, getTenantSettings, paymentSettingsSchema, saveTenantSettings } from '../services/tenantSettings.js';

const optional = (max: number, min = 1) => z.coerce.number().int().min(min).max(max).nullable().default(null);

export const packageInput = z.object({
  name: z.record(z.string().regex(/^[a-z]{2}$/), z.string().trim().max(80)),
  priceCents: z.coerce.number().int().min(50).max(1_000_000),
  durationMinutes: z.coerce.number().int().min(5).max(525_600),
  dataLimitMb: optional(1_048_576),
  downKbps: optional(10_000_000, 64),
  upKbps: optional(10_000_000, 64),
  active: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
});

export async function paymentRoutes(app: FastifyInstance) {
  app.get('/api/payment-settings', async (req) => {
    const tenantId = tenantScope(req);
    const base = (await tenantPortalOrigin(tenantId)) ?? (await adminBaseUrl());
    // Addresses the customer enters at Stripe, and the hosts guests need before they have access
    return {
      settings: await getPublicTenantSettings(tenantId, 'payments'),
      stripeWebhookUrl: `${base}/portal/webhooks/stripe/${tenantId}`,
      mollieWebhookUrl: `${base}/portal/webhooks/mollie`,
    };
  });

  app.put('/api/payment-settings', async (req) => {
    const tenantId = tenantScope(req, true);
    const input = sentOnly(paymentSettingsSchema.partial().passthrough().parse(req.body), req.body) as Record<string, unknown>;
    await saveTenantSettings(tenantId, 'payments', input);
    await audit(req, 'payments.settings.updated', { provider: input.provider }, tenantId);
    return { settings: await getPublicTenantSettings(tenantId, 'payments') };
  });

  // Checks the API key as typed in the form, falling back to the stored one
  app.post('/api/payment-settings/test', async (req) => {
    const tenantId = tenantScope(req, true);
    const form = (req.body ?? {}) as Record<string, string>;
    const stored = await getTenantSettings(tenantId, 'payments');
    const merged = paymentSettingsSchema.parse({
      ...stored,
      provider: form.provider || stored.provider,
      mollieApiKey: form.mollieApiKey || stored.mollieApiKey,
      stripeSecretKey: form.stripeSecretKey || stored.stripeSecretKey,
    });
    return testProvider(merged);
  });

  app.get('/api/payment-packages', async (req) => {
    const tenantId = tenantScope(req);
    const rows = await db.query.paymentPackages.findMany({
      where: eq(schema.paymentPackages.tenantId, tenantId),
      orderBy: [asc(schema.paymentPackages.sortOrder), asc(schema.paymentPackages.priceCents)],
    });
    return { packages: rows };
  });

  app.post('/api/payment-packages', async (req) => {
    const tenantId = tenantScope(req, true);
    const input = packageInput.parse(req.body);
    const [row] = await db.insert(schema.paymentPackages).values({ tenantId, ...input }).returning();
    await audit(req, 'payments.package.created', { id: row.id }, tenantId);
    return { package: row };
  });

  app.put<{ Params: { id: string } }>('/api/payment-packages/:id', async (req) => {
    const tenantId = tenantScope(req, true);
    const input = packageInput.parse(req.body);
    const [row] = await db
      .update(schema.paymentPackages)
      .set(input)
      .where(and(eq(schema.paymentPackages.id, uuidParam(req.params.id)), eq(schema.paymentPackages.tenantId, tenantId)))
      .returning();
    if (!row) throw notFound();
    await audit(req, 'payments.package.updated', { id: row.id }, tenantId);
    return { package: row };
  });

  app.delete<{ Params: { id: string } }>('/api/payment-packages/:id', async (req) => {
    const tenantId = tenantScope(req, true);
    const [row] = await db
      .delete(schema.paymentPackages)
      .where(and(eq(schema.paymentPackages.id, uuidParam(req.params.id)), eq(schema.paymentPackages.tenantId, tenantId)))
      .returning();
    if (!row) throw notFound();
    await audit(req, 'payments.package.deleted', { id: row.id }, tenantId);
    return { ok: true };
  });

  app.get('/api/payments', async (req) => {
    const tenantId = tenantScope(req);
    const [rows, totals] = await Promise.all([
      db.query.payments.findMany({ where: eq(schema.payments.tenantId, tenantId), orderBy: desc(schema.payments.createdAt), limit: 500 }),
      db.execute(sql`
        select currency,
               count(*) filter (where status = 'paid') as paid,
               coalesce(sum(amount_cents) filter (where status = 'paid'), 0) as total,
               coalesce(sum(amount_cents) filter (where status = 'paid' and paid_at >= date_trunc('month', now())), 0) as month
          from payments where tenant_id = ${tenantId} group by currency`),
    ]);
    return {
      payments: rows.map(({ checkoutUrl: _c, ...p }) => p),
      totals: totals.rows.map((r) => ({ currency: String(r.currency), paid: Number(r.paid), totalCents: Number(r.total), monthCents: Number(r.month) })),
    };
  });
}
