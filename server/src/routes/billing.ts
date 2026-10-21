import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import type { Invoice } from '../db/schema.js';
import { DEFAULT_LOCALE, normalizeLocale, requestLocale, t } from '../i18n/index.js';
import { audit, requireSuperadmin, requireUser } from '../lib/auth.js';
import { badRequest, forbidden, notFound, translateError } from '../lib/errors.js';
import { uuidParam } from '../lib/ids.js';
import {
  billingProfile,
  createInvoice,
  invoiceFileName,
  isOverdue,
  issueInvoice,
  markInvoicePaid,
  payUrl,
  refreshInvoicePayment,
  reviewSuspension,
  sendInvoiceMail,
  startInvoicePayment,
  todayIso,
  updateDraft,
  voidInvoice,
} from '../services/billing.js';
import { renderInvoicePdf } from '../services/invoicePdf.js';
import { testProvider, verifyStripeSignature } from '../services/payments.js';
import { adminBaseUrl, getSettings } from '../services/settings.js';
import { renderInvoicePage, renderPayNotFound, renderPayResult } from '../views/billing.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const interval = z.enum(['month', 'quarter', 'year']);
const cents = z.coerce.number().int().min(0).max(100_000_000);

export const planInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  priceCents: cents,
  interval: interval.default('month'),
  active: z.boolean().default(true),
});

export const profileInput = z.object({
  companyName: z.string().trim().max(200).default(''),
  address: z.string().max(1000).default(''),
  email: z.union([z.email(), z.literal('')]).default(''),
  vatNumber: z.string().trim().max(40).default(''),
  reference: z.string().trim().max(120).default(''),
  locale: z.enum(['en', 'nl']).default('en'),
  vatRateBp: z.coerce.number().int().min(0).max(10_000).default(2100),
  reverseCharge: z.boolean().default(false),
  subscriptionActive: z.boolean().default(false),
  planId: z.uuid().nullable().default(null),
  planName: z.string().trim().max(120).default(''),
  priceCents: cents.default(0),
  interval: interval.default('month'),
  startDate: date.nullable().default(null),
  // Only sent when the admin moves the next invoice date by hand
  nextInvoiceDate: date.nullable().optional(),
  autoSuspend: z.boolean().default(true),
});

const lineInput = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.coerce.number().min(0.01).max(100_000),
  unitCents: z.coerce.number().int().min(-100_000_000).max(100_000_000),
});

export const invoiceInput = z.object({
  lines: z.array(lineInput).min(1).max(50),
  notes: z.string().max(2000).default(''),
  vatRateBp: z.coerce.number().int().min(0).max(10_000).optional(),
  reverseCharge: z.boolean().optional(),
  periodStart: date.nullable().optional(),
  periodEnd: date.nullable().optional(),
});

/** What the admin interface shows of an invoice: no pay token, but the pay link. */
async function publicInvoice(inv: Invoice, today = todayIso()) {
  const { payToken: _p, ...rest } = inv;
  return { ...rest, overdue: isOverdue(inv, today), payUrl: inv.status === 'open' ? await payUrl(inv) : null };
}

async function loadInvoice(id: string) {
  const inv = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, uuidParam(id)) });
  if (!inv) throw notFound();
  return inv;
}

/** Platform admins see every invoice; customer admins their own issued invoices. */
function canSee(req: FastifyRequest, inv: Invoice) {
  const user = requireUser(req);
  if (user.role === 'superadmin') return;
  if (user.role !== 'tenant_admin' || inv.tenantId !== user.tenantId || inv.status === 'draft') throw forbidden();
}

async function sendPdf(reply: FastifyReply, inv: Invoice, disposition: 'inline' | 'attachment') {
  const pdf = await renderInvoicePdf(inv, { payUrl: await payUrl(inv) });
  return reply
    .header('content-type', 'application/pdf')
    .header('content-disposition', `${disposition}; filename="${invoiceFileName(inv)}"`)
    .header('cache-control', 'private, no-store')
    .send(pdf);
}

export async function billingRoutes(app: FastifyInstance) {
  // ── Plans ──────────────────────────────────────────────────────────────────
  app.get('/api/billing/plans', async (req) => {
    requireSuperadmin(req);
    return { plans: await db.query.billingPlans.findMany({ orderBy: [asc(schema.billingPlans.priceCents)] }) };
  });

  app.post('/api/billing/plans', async (req) => {
    requireSuperadmin(req);
    const [plan] = await db.insert(schema.billingPlans).values(planInput.parse(req.body)).returning();
    await audit(req, 'billing.plan.created', { name: plan.name }, null);
    return { plan };
  });

  app.put<{ Params: { id: string } }>('/api/billing/plans/:id', async (req) => {
    requireSuperadmin(req);
    const [plan] = await db.update(schema.billingPlans).set(planInput.parse(req.body)).where(eq(schema.billingPlans.id, uuidParam(req.params.id))).returning();
    if (!plan) throw notFound();
    await audit(req, 'billing.plan.updated', { name: plan.name }, null);
    return { plan };
  });

  app.delete<{ Params: { id: string } }>('/api/billing/plans/:id', async (req) => {
    requireSuperadmin(req);
    const [plan] = await db.delete(schema.billingPlans).where(eq(schema.billingPlans.id, uuidParam(req.params.id))).returning();
    if (!plan) throw notFound();
    await audit(req, 'billing.plan.deleted', { name: plan.name }, null);
    return { ok: true };
  });

  // ── Customers: billing profile and subscription ────────────────────────────
  app.get('/api/billing/customers', async (req) => {
    requireSuperadmin(req);
    const [tenants, profiles, open] = await Promise.all([
      db.query.tenants.findMany({ orderBy: asc(schema.tenants.name) }),
      db.query.tenantBilling.findMany(),
      db.execute(sql`
        select tenant_id,
               coalesce(sum(total_cents), 0) as open,
               coalesce(sum(total_cents) filter (where due_date < ${todayIso()}), 0) as overdue
          from invoices where status = 'open' and tenant_id is not null group by tenant_id`),
    ]);
    const byTenant = new Map(profiles.map((p) => [p.tenantId, p]));
    const amounts = new Map(open.rows.map((r) => [String(r.tenant_id), { openCents: Number(r.open), overdueCents: Number(r.overdue) }]));
    return {
      customers: tenants.map((tn) => ({
        tenant: { id: tn.id, name: tn.name, slug: tn.slug, contactEmail: tn.contactEmail, status: tn.status, billingSuspendedAt: tn.billingSuspendedAt },
        profile: byTenant.get(tn.id) ?? null,
        ...(amounts.get(tn.id) ?? { openCents: 0, overdueCents: 0 }),
      })),
    };
  });

  app.put<{ Params: { tenantId: string } }>('/api/billing/customers/:tenantId', async (req) => {
    requireSuperadmin(req);
    const tenantId = uuidParam(req.params.tenantId);
    const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, tenantId) });
    if (!tenant) throw notFound();
    const input = profileInput.parse(req.body);
    const current = await billingProfile(tenantId);
    const today = todayIso();
    const startDate = input.startDate ?? current?.startDate ?? (input.subscriptionActive ? today : null);
    // The schedule only moves on its own when a subscription starts; after that the admin moves it by hand
    let nextInvoiceDate = current?.nextInvoiceDate ?? null;
    if (input.nextInvoiceDate !== undefined) nextInvoiceDate = input.nextInvoiceDate;
    else if (input.subscriptionActive && !current?.subscriptionActive) {
      // First start: from the start date (past periods are invoiced too). Restart: never for the paused time
      nextInvoiceDate = !current?.nextInvoiceDate ? startDate : current.nextInvoiceDate < today ? today : current.nextInvoiceDate;
    } else if (input.subscriptionActive && current?.nextInvoiceDate === current?.startDate && startDate !== current?.startDate) {
      // Nothing invoiced yet: follow the new start date
      nextInvoiceDate = startDate;
    }
    const values = { ...input, startDate, nextInvoiceDate, updatedAt: new Date() };
    const [profile] = await db
      .insert(schema.tenantBilling)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: schema.tenantBilling.tenantId, set: values })
      .returning();
    await reviewSuspension(tenantId);
    await audit(req, 'billing.customer.updated', { subscription: profile.subscriptionActive, plan: profile.planName, priceCents: profile.priceCents }, tenantId);
    return { profile };
  });

  // Lifts a portal pause by hand; with automatic pausing on it comes back while invoices stay overdue
  app.post<{ Params: { tenantId: string } }>('/api/billing/customers/:tenantId/resume', async (req) => {
    requireSuperadmin(req);
    const tenantId = uuidParam(req.params.tenantId);
    const [tenant] = await db.update(schema.tenants).set({ billingSuspendedAt: null }).where(eq(schema.tenants.id, tenantId)).returning();
    if (!tenant) throw notFound();
    await audit(req, 'billing.portal.resumed', undefined, tenantId);
    return { ok: true };
  });

  // ── Invoices ───────────────────────────────────────────────────────────────
  app.get<{ Querystring: { tenant?: string } }>('/api/billing/invoices', async (req) => {
    requireSuperadmin(req);
    const tenantId = req.query.tenant ? uuidParam(req.query.tenant) : null;
    const today = todayIso();
    const [rows, totals] = await Promise.all([
      db.query.invoices.findMany({ where: tenantId ? eq(schema.invoices.tenantId, tenantId) : undefined, orderBy: desc(schema.invoices.createdAt), limit: 1000 }),
      db.execute(sql`
        select coalesce(sum(total_cents) filter (where status = 'open'), 0) as open,
               coalesce(sum(total_cents) filter (where status = 'open' and due_date < ${today}), 0) as overdue,
               count(*) filter (where status = 'open' and due_date < ${today}) as overdue_count,
               coalesce(sum(total_cents) filter (where status = 'paid' and paid_at >= date_trunc('month', now())), 0) as paid_month,
               count(*) filter (where status = 'draft') as drafts
          from invoices`),
      ]);
    const mrr = await db.execute(sql`
      select coalesce(sum(case interval when 'month' then price_cents when 'quarter' then price_cents / 3.0 else price_cents / 12.0 end), 0) as mrr,
             count(*) as subscriptions
        from tenant_billing where subscription_active`);
    const tot = totals.rows[0];
    return {
      invoices: await Promise.all(rows.map((r) => publicInvoice(r, today))),
      totals: {
        openCents: Number(tot.open),
        overdueCents: Number(tot.overdue),
        overdueCount: Number(tot.overdue_count),
        paidMonthCents: Number(tot.paid_month),
        drafts: Number(tot.drafts),
        mrrCents: Math.round(Number(mrr.rows[0].mrr)),
        subscriptions: Number(mrr.rows[0].subscriptions),
      },
    };
  });

  app.post('/api/billing/invoices', async (req) => {
    requireSuperadmin(req);
    const { tenantId, ...input } = invoiceInput.extend({ tenantId: z.uuid() }).parse(req.body);
    const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, tenantId) });
    if (!tenant) throw notFound();
    const invoice = await createInvoice(tenantId, input);
    await audit(req, 'billing.invoice.created', { id: invoice.id }, tenantId);
    return { invoice: await publicInvoice(invoice) };
  });

  app.put<{ Params: { id: string } }>('/api/billing/invoices/:id', async (req) => {
    requireSuperadmin(req);
    const invoice = await updateDraft(uuidParam(req.params.id), invoiceInput.parse(req.body));
    if (!invoice) throw notFound();
    return { invoice: await publicInvoice(invoice) };
  });

  app.delete<{ Params: { id: string } }>('/api/billing/invoices/:id', async (req) => {
    requireSuperadmin(req);
    const inv = await loadInvoice(req.params.id);
    if (inv.status !== 'draft') throw badRequest('errors.invoiceNotDraft');
    await db.delete(schema.invoices).where(and(eq(schema.invoices.id, inv.id), eq(schema.invoices.status, 'draft')));
    await audit(req, 'billing.invoice.deleted', { id: inv.id }, inv.tenantId);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/billing/invoices/:id/issue', async (req) => {
    requireSuperadmin(req);
    const { send } = z.object({ send: z.boolean().default(true) }).parse(req.body ?? {});
    const result = await issueInvoice(uuidParam(req.params.id), { send });
    await audit(req, 'billing.invoice.issued', { number: result.invoice.number, sent: result.sent }, result.invoice.tenantId);
    return { invoice: await publicInvoice(result.invoice), sent: result.sent, error: 'error' in result ? translateError(result.error, requestLocale(req)) : undefined };
  });

  app.post<{ Params: { id: string } }>('/api/billing/invoices/:id/send', async (req) => {
    requireSuperadmin(req);
    const { reminder } = z.object({ reminder: z.boolean().default(false) }).parse(req.body ?? {});
    const inv = await loadInvoice(req.params.id);
    if (inv.status === 'draft' || (reminder && inv.status !== 'open')) throw badRequest('errors.invoiceNotOpen');
    const invoice = await sendInvoiceMail(inv, reminder ? 'invoiceReminder' : 'invoice');
    await audit(req, reminder ? 'billing.invoice.reminded' : 'billing.invoice.sent', { number: inv.number }, inv.tenantId);
    return { invoice: await publicInvoice(invoice) };
  });

  app.post<{ Params: { id: string } }>('/api/billing/invoices/:id/mark-paid', async (req) => {
    requireSuperadmin(req);
    const { notify } = z.object({ notify: z.boolean().default(false) }).parse(req.body ?? {});
    const invoice = await markInvoicePaid(uuidParam(req.params.id), { via: 'manual', notify });
    if (!invoice) throw badRequest('errors.invoiceNotOpen');
    await audit(req, 'billing.invoice.paid', { number: invoice.number }, invoice.tenantId);
    return { invoice: await publicInvoice(invoice) };
  });

  app.post<{ Params: { id: string } }>('/api/billing/invoices/:id/void', async (req) => {
    requireSuperadmin(req);
    const invoice = await voidInvoice(uuidParam(req.params.id));
    if (!invoice) throw badRequest('errors.invoiceNotOpen');
    await audit(req, 'billing.invoice.voided', { number: invoice.number }, invoice.tenantId);
    return { invoice: await publicInvoice(invoice) };
  });

  app.get<{ Params: { id: string }; Querystring: { download?: string } }>('/api/billing/invoices/:id/pdf', async (req, reply) => {
    const inv = await loadInvoice(req.params.id);
    canSee(req, inv);
    return sendPdf(reply, inv, req.query.download ? 'attachment' : 'inline');
  });

  // Checks the platform's Mollie or Stripe key as typed, falling back to the stored one
  app.post('/api/billing/provider-test', async (req) => {
    requireSuperadmin(req);
    const form = (req.body ?? {}) as Record<string, string>;
    const stored = await getSettings('billing');
    return testProvider({
      provider: (form.provider as 'none' | 'mollie' | 'stripe') || stored.provider,
      mollieApiKey: form.mollieApiKey || stored.mollieApiKey,
      stripeSecretKey: form.stripeSecretKey || stored.stripeSecretKey,
    });
  });

  // ── The customer's own invoices ────────────────────────────────────────────
  app.get('/api/invoices', async (req) => {
    const user = requireUser(req);
    if (user.role !== 'tenant_admin' || !user.tenantId) throw forbidden();
    const today = todayIso();
    const [rows, profile, tenant, settings] = await Promise.all([
      db.query.invoices.findMany({
        where: and(eq(schema.invoices.tenantId, user.tenantId), inArray(schema.invoices.status, ['open', 'paid', 'void'])),
        orderBy: desc(schema.invoices.issueDate),
      }),
      billingProfile(user.tenantId),
      db.query.tenants.findFirst({ where: eq(schema.tenants.id, user.tenantId) }),
      getSettings('billing'),
    ]);
    return {
      invoices: await Promise.all(rows.map((r) => publicInvoice(r, today))),
      subscription: profile?.subscriptionActive
        ? { planName: profile.planName, priceCents: profile.priceCents, interval: profile.interval, vatRateBp: profile.reverseCharge ? 0 : profile.vatRateBp, nextInvoiceDate: profile.nextInvoiceDate }
        : null,
      currency: settings.currency,
      company: settings.companyName,
      canPayOnline: settings.provider !== 'none',
      suspended: Boolean(tenant?.billingSuspendedAt),
    };
  });

  // ── Public pay link (from the e-mail), on the platform's own address ───────
  const html = (reply: FastifyReply, body: string, code = 200) => reply.code(code).header('cache-control', 'no-store').type('text/html; charset=utf-8').send(body);
  const byToken = async (token: string) => (/^[\w-]{20,64}$/.test(token) ? db.query.invoices.findFirst({ where: eq(schema.invoices.payToken, token) }) : undefined);
  const page = async (req: FastifyRequest, reply: FastifyReply, inv: Invoice, error?: string) => {
    const settings = await getSettings('billing');
    const locale = normalizeLocale(inv.locale) ?? DEFAULT_LOCALE;
    return html(reply, renderInvoicePage(locale, inv, { logo: settings.logo, canPay: settings.provider !== 'none', overdue: isOverdue(inv), base: await adminBaseUrl(), error }));
  };

  app.get<{ Params: { token: string } }>('/billing/pay/:token', async (req, reply) => {
    const inv = await byToken(req.params.token);
    if (!inv || inv.status === 'draft') return html(reply, renderPayNotFound(requestLocale(req)), 404);
    return page(req, reply, inv);
  });

  app.post<{ Params: { token: string } }>('/billing/pay/:token', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const inv = await byToken(req.params.token);
    if (!inv || inv.status === 'draft') return html(reply, renderPayNotFound(requestLocale(req)), 404);
    if (inv.status !== 'open') return reply.redirect(`/billing/pay/${inv.payToken}`, 303);
    try {
      const { url } = await startInvoicePayment(inv, await adminBaseUrl());
      return reply.redirect(url, 303);
    } catch (err) {
      req.log.warn({ err, invoice: inv.id }, 'invoice payment could not start');
      return page(req, reply, inv, translateError(err, normalizeLocale(inv.locale) ?? DEFAULT_LOCALE));
    }
  });

  app.get<{ Params: { token: string }; Querystring: { a?: string; cancel?: string } }>('/billing/pay/:token/return', async (req, reply) => {
    let inv = await byToken(req.params.token);
    if (!inv || inv.status === 'draft') return html(reply, renderPayNotFound(requestLocale(req)), 404);
    const settings = await getSettings('billing');
    const base = await adminBaseUrl();
    const locale = normalizeLocale(inv.locale) ?? DEFAULT_LOCALE;
    let attempt = req.query.a && /^[0-9a-f-]{36}$/.test(req.query.a) ? await db.query.invoicePayments.findFirst({ where: and(eq(schema.invoicePayments.id, req.query.a), eq(schema.invoicePayments.invoiceId, inv.id)) }) : undefined;
    if (attempt) attempt = await refreshInvoicePayment(attempt).catch(() => attempt);
    inv = (await db.query.invoices.findFirst({ where: eq(schema.invoices.id, inv.id) })) ?? inv;
    const state = inv.status === 'paid' ? 'paid' : attempt?.status === 'open' && !req.query.cancel ? 'pending' : 'failed';
    const self = `${base}/billing/pay/${inv.payToken}/return?a=${attempt?.id ?? ''}`;
    return html(reply, renderPayResult(locale, inv, { logo: settings.logo, state, base, self }));
  });

  app.get<{ Params: { token: string } }>('/billing/pay/:token/pdf', async (req, reply) => {
    const inv = await byToken(req.params.token);
    if (!inv || inv.status === 'draft') return reply.code(404).send(t(requestLocale(req), 'invoice.payNotFound'));
    return sendPdf(reply, inv, 'inline');
  });

  // Mollie posts the payment id; the status is always fetched from Mollie itself
  app.post<{ Body: { id?: string } }>('/billing/webhooks/mollie', async (req, reply) => {
    const id = typeof req.body?.id === 'string' ? req.body.id.slice(0, 64) : '';
    const attempt = id ? await db.query.invoicePayments.findFirst({ where: and(eq(schema.invoicePayments.provider, 'mollie'), eq(schema.invoicePayments.providerRef, id)) }) : null;
    if (attempt) await refreshInvoicePayment(attempt).catch((err) => req.log.error({ err, attempt: attempt.id }, 'billing mollie webhook'));
    return reply.code(200).send('ok');
  });

  // Stripe: signed with the platform's webhook secret; the raw body is needed for the signature
  await app.register(async (sub) => {
    sub.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 256_000 }, (_req, body, done) => done(null, body));
    sub.post<{ Body: string }>('/billing/webhooks/stripe', async (req, reply) => {
      const settings = await getSettings('billing');
      if (!verifyStripeSignature(String(req.body), req.headers['stripe-signature'] as string | undefined, settings.stripeWebhookSecret)) return reply.code(400).send('bad signature');
      const event = JSON.parse(String(req.body)) as { type?: string; data?: { object?: { id?: string } } };
      const ref = event.data?.object?.id;
      if (ref && event.type?.startsWith('checkout.session.')) {
        const attempt = await db.query.invoicePayments.findFirst({ where: and(eq(schema.invoicePayments.provider, 'stripe'), eq(schema.invoicePayments.providerRef, ref)) });
        if (attempt) await refreshInvoicePayment(attempt).catch((err) => req.log.error({ err, attempt: attempt.id }, 'billing stripe webhook'));
      }
      return reply.code(200).send({ received: true });
    });
  });
}
