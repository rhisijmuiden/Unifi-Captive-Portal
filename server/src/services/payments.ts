import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { GuestSession, Payment, PaymentPackage } from '../db/schema.js';
import { normalizeLocale, t, type Locale } from '../i18n/index.js';
import { badRequest } from '../lib/errors.js';
import { moneyLabel } from '../shared/guestStrings.js';
import { authorizeSession } from './guests.js';
import { sendGuestMail } from './notifications.js';
import { getTenantSettings, type TenantSettingsValue } from './tenantSettings.js';

/**
 * Paid access through Mollie or Stripe, with the customer's own account. We talk to their
 * REST APIs directly; the status is always fetched from the provider, never trusted from
 * a redirect or webhook body.
 */

const MOLLIE_API = process.env.MOLLIE_API_URL ?? 'https://api.mollie.com/v2';
const STRIPE_API = process.env.STRIPE_API_URL ?? 'https://api.stripe.com/v1';

type Settings = TenantSettingsValue<'payments'>;
type Status = Payment['status'];

export class PaymentError extends Error {}

async function providerCall<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new PaymentError((err as Error).message);
  }
  const body = (await res.json().catch(() => ({}))) as T & { detail?: string; error?: { message?: string } };
  if (!res.ok) throw new PaymentError(body.detail ?? body.error?.message ?? `HTTP ${res.status}`);
  return body;
}

const mollie = <T>(key: string, path: string, body?: unknown) =>
  providerCall<T>(`${MOLLIE_API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

const stripe = <T>(key: string, path: string, form?: Record<string, string>) =>
  providerCall<T>(`${STRIPE_API}${path}`, {
    method: form ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${key}`, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });

const mollieStatus = (s: string): Status =>
  s === 'paid' ? 'paid' : s === 'failed' ? 'failed' : s === 'canceled' ? 'canceled' : s === 'expired' ? 'expired' : 'open';

/** Webhooks can only reach a public address; localhost and private networks are skipped. */
export const isPublicUrl = (url: string) => {
  const host = new URL(url).hostname;
  return !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(host) && host.includes('.');
};

export function assertConfigured(s: Settings) {
  if (s.provider === 'mollie' && s.mollieApiKey) return;
  if (s.provider === 'stripe' && s.stripeSecretKey) return;
  throw badRequest('errors.paymentProvider');
}

/** Checks the API key with a harmless read call. */
export async function testProvider(s: Settings) {
  assertConfigured(s);
  try {
    if (s.provider === 'mollie') {
      const r = await mollie<{ count?: number }>(s.mollieApiKey, '/methods');
      return { ok: true, mode: s.mollieApiKey.startsWith('test_') ? 'test' : 'live', methods: r.count ?? 0 };
    }
    await stripe<unknown>(s.stripeSecretKey, '/balance');
    return { ok: true, mode: s.stripeSecretKey.startsWith('sk_test_') ? 'test' : 'live' };
  } catch (err) {
    throw badRequest('errors.paymentApi', { reason: (err as Error).message });
  }
}

export const packageName = (pkg: Pick<PaymentPackage, 'name'>, locale: string) => pkg.name[locale] || pkg.name.en || Object.values(pkg.name).find(Boolean) || '—';

/** Creates the payment and the checkout at the provider; returns where to send the guest. */
export async function startPayment(opts: {
  session: GuestSession;
  pkg: PaymentPackage;
  email: string | null;
  locale: Locale;
  returnBase: string;
  webhookBase: string;
}) {
  const { session, pkg, locale } = opts;
  const s = await getTenantSettings(session.tenantId, 'payments');
  assertConfigured(s);
  const name = packageName(pkg, locale);
  const [payment] = await db
    .insert(schema.payments)
    .values({
      tenantId: session.tenantId,
      guestSessionId: session.id,
      packageId: pkg.id,
      packageName: name,
      durationMinutes: pkg.durationMinutes,
      provider: s.provider as 'mollie' | 'stripe',
      amountCents: pkg.priceCents,
      currency: s.currency,
      email: opts.email,
      locale,
    })
    .returning();
  const returnUrl = `${opts.returnBase}/portal/${session.token}/pay/return?p=${payment.id}`;
  const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, session.tenantId) });
  const description = `${tenant?.name ?? 'Wi-Fi'} - ${name}`.slice(0, 120);
  try {
    let ref: string;
    let url: string;
    if (s.provider === 'mollie') {
      const webhookUrl = `${opts.webhookBase}/portal/webhooks/mollie`;
      const r = await mollie<{ id: string; _links: { checkout?: { href: string } } }>(s.mollieApiKey, '/payments', {
        amount: { currency: s.currency, value: (pkg.priceCents / 100).toFixed(2) },
        description,
        redirectUrl: returnUrl,
        ...(isPublicUrl(webhookUrl) ? { webhookUrl } : {}),
        locale: locale === 'nl' ? 'nl_NL' : 'en_US',
        metadata: { paymentId: payment.id },
      });
      ref = r.id;
      url = r._links.checkout?.href ?? '';
    } else {
      const r = await stripe<{ id: string; url: string }>(s.stripeSecretKey, '/checkout/sessions', {
        mode: 'payment',
        success_url: returnUrl,
        cancel_url: `${returnUrl}&cancel=1`,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': s.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': String(pkg.priceCents),
        'line_items[0][price_data][product_data][name]': description,
        client_reference_id: payment.id,
        'metadata[paymentId]': payment.id,
        'metadata[tenantId]': session.tenantId,
        locale: locale === 'nl' ? 'nl' : 'en',
        ...(opts.email ? { customer_email: opts.email } : {}),
      });
      ref = r.id;
      url = r.url;
    }
    if (!url) throw new PaymentError('no checkout URL');
    await db.update(schema.payments).set({ providerRef: ref, checkoutUrl: url }).where(eq(schema.payments.id, payment.id));
    return { payment: { ...payment, providerRef: ref, checkoutUrl: url }, url, graceMinutes: s.graceMinutes };
  } catch (err) {
    await db.update(schema.payments).set({ status: 'failed' }).where(eq(schema.payments.id, payment.id));
    throw err;
  }
}

/** Asks the provider for the current status and finishes the payment when it is paid. */
export async function refreshPayment(payment: Payment) {
  if (payment.status !== 'open' || !payment.providerRef) return payment;
  const s = await getTenantSettings(payment.tenantId, 'payments');
  let status: Status = 'open';
  if (payment.provider === 'mollie') {
    if (!s.mollieApiKey) return payment;
    const r = await mollie<{ status: string }>(s.mollieApiKey, `/payments/${encodeURIComponent(payment.providerRef)}`);
    status = mollieStatus(r.status);
  } else {
    if (!s.stripeSecretKey) return payment;
    const r = await stripe<{ status: string; payment_status: string }>(s.stripeSecretKey, `/checkout/sessions/${encodeURIComponent(payment.providerRef)}`);
    status = r.payment_status === 'paid' ? 'paid' : r.status === 'expired' ? 'expired' : 'open';
  }
  if (status === 'paid') return (await finalizePayment(payment.id)) ?? payment;
  if (status !== 'open') {
    const [row] = await db.update(schema.payments).set({ status }).where(and(eq(schema.payments.id, payment.id), eq(schema.payments.status, 'open'))).returning();
    return row ?? payment;
  }
  return payment;
}

/** Marks the payment paid (once) and gives the guest the package's access. */
export async function finalizePayment(paymentId: string) {
  const [payment] = await db
    .update(schema.payments)
    .set({ status: 'paid', paidAt: new Date() })
    .where(and(eq(schema.payments.id, paymentId), inArray(schema.payments.status, ['open', 'expired', 'canceled', 'failed'])))
    .returning();
  if (!payment) return null;
  const session = payment.guestSessionId ? await db.query.guestSessions.findFirst({ where: eq(schema.guestSessions.id, payment.guestSessionId) }) : null;
  if (!session) return payment;
  const pkg = payment.packageId ? await db.query.paymentPackages.findFirst({ where: eq(schema.paymentPackages.id, payment.packageId) }) : null;
  const result = await authorizeSession(session, {
    limits: { timeLimitMinutes: payment.durationMinutes, dataLimitMb: pkg?.dataLimitMb, downKbps: pkg?.downKbps, upKbps: pkg?.upKbps },
    record: { method: 'payment', paymentId: payment.id, email: payment.email ?? session.email, locale: payment.locale },
  });
  if (payment.email) {
    const locale = normalizeLocale(payment.locale) ?? 'en';
    const until = result.ok ? result.session.accessUntil : null;
    void sendGuestMail('paymentReceipt', payment.tenantId, payment.email, locale, {
      name: session.name ?? '',
      email: payment.email,
      package: payment.packageName,
      amount: moneyLabel(locale, payment.amountCents, payment.currency),
      reference: payment.providerRef ?? payment.id,
      date: payment.paidAt ?? new Date(),
      validUntil: until,
      rows: [
        [t(locale, 'mail.receiptPackage'), payment.packageName],
        [t(locale, 'mail.receiptAmount'), moneyLabel(locale, payment.amountCents, payment.currency)],
        [t(locale, 'mail.receiptReference'), payment.providerRef ?? payment.id],
      ],
    });
  }
  return payment;
}

/** Background job: open payments of the last hour are checked, for when no webhook arrives. */
export async function pollOpenPayments() {
  const rows = await db.query.payments.findMany({
    where: and(eq(schema.payments.status, 'open'), gt(schema.payments.createdAt, new Date(Date.now() - 3600_000))),
  });
  for (const p of rows) await refreshPayment(p).catch(() => undefined);
  // Older open payments will not be paid anymore
  await db
    .update(schema.payments)
    .set({ status: 'expired' })
    .where(and(eq(schema.payments.status, 'open'), lt(schema.payments.createdAt, new Date(Date.now() - 3 * 3600_000))));
}

/** Stripe-Signature: t=<time>,v1=<hmac of "<time>.<body>">, max 5 minutes old. */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const ts = Number(parts.t);
  if (!ts || Math.abs(now / 1000 - ts) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest();
  return header
    .split(',')
    .filter((p) => p.startsWith('v1='))
    .some((p) => {
      const sig = Buffer.from(p.slice(3), 'hex');
      return sig.length === expected.length && timingSafeEqual(sig, expected);
    });
}
