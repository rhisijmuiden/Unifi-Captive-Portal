import { and, asc, eq, gt, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { BillingParty, Invoice, InvoiceLine, InvoicePayment, TenantBilling } from '../db/schema.js';
import { DEFAULT_LOCALE, normalizeLocale, t, type Locale } from '../i18n/index.js';
import { randomToken } from '../lib/crypto.js';
import { badRequest } from '../lib/errors.js';
import { moneyLabel } from '../shared/guestStrings.js';
import type { MailKind } from '../shared/mailDesign.js';
import { renderInvoicePdf } from './invoicePdf.js';
import { sendTemplate } from './mailTemplates.js';
import { assertConfigured, isPublicUrl, mollie, mollieStatus, PaymentError, stripe } from './payments.js';
import { TIME_ZONE } from './reports.js';
import { adminBaseUrl, getSettings, type SettingsValue } from './settings.js';

/**
 * Billing customers (tenants) for their portal. The platform admin keeps a billing profile
 * with a subscription per customer; invoices are created in advance for every period,
 * numbered without gaps when issued, e-mailed with a PDF and can be paid online through
 * the platform's own Mollie or Stripe account. Overdue invoices get reminders and can
 * pause the customer's guest portal until they are paid.
 */

type BillingSettings = SettingsValue<'billing'>;
type Interval = TenantBilling['interval'];
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const pad = (n: number) => String(n).padStart(2, '0');

// ── Dates (YYYY-MM-DD, in the platform's time zone) ──────────────────────────

export const todayIso = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Adds months and keeps the anchor day where the month has it (31 Jan → 28 Feb → 31 Mar). */
export function addMonths(iso: string, months: number, anchorDay = Number(iso.slice(8, 10))) {
  const [y, m] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${pad(month + 1)}-${pad(Math.min(anchorDay, last))}`;
}

export const intervalMonths: Record<Interval, number> = { month: 1, quarter: 3, year: 12 };

/** The period that starts on `start`; `anchor` is the subscription's start date. */
export function billingPeriod(start: string, interval: Interval, anchor: string) {
  const next = addMonths(start, intervalMonths[interval], Number(anchor.slice(8, 10)));
  return { start, end: addDays(next, -1), next };
}

export const formatDay = (locale: Locale, iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
};

export const formatRate = (locale: Locale, bp: number) => `${new Intl.NumberFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', { maximumFractionDigits: 2 }).format(bp / 100)}%`;

// ── Amounts and numbers ──────────────────────────────────────────────────────

export const lineTotal = (l: InvoiceLine) => Math.round(l.quantity * l.unitCents);

export function invoiceTotals(lines: InvoiceLine[], vatRateBp: number, reverseCharge: boolean) {
  const subtotalCents = lines.reduce((s, l) => s + lineTotal(l), 0);
  const vatCents = reverseCharge ? 0 : Math.round((subtotalCents * vatRateBp) / 10_000);
  return { subtotalCents, vatCents, totalCents: subtotalCents + vatCents };
}

export const numberPrefix = (prefix: string, issueDate: string) => prefix.replaceAll('{year}', issueDate.slice(0, 4));

/** The next number for the prefix; inside the issuing transaction, so a failed issue leaves no gap. */
async function nextInvoiceNumber(tx: Tx, s: BillingSettings, issueDate: string) {
  const prefix = numberPrefix(s.numberPrefix, issueDate);
  const { rows } = await tx.execute(sql`
    insert into invoice_sequences (prefix, last) values (${prefix}, 1)
    on conflict (prefix) do update set last = invoice_sequences.last + 1
    returning last`);
  return `${prefix}${String(rows[0].last).padStart(s.numberDigits, '0')}`;
}

// ── Parties ──────────────────────────────────────────────────────────────────

export const sellerParty = (s: BillingSettings): BillingParty => ({
  name: s.companyName,
  address: s.address,
  email: s.email,
  phone: s.phone,
  website: s.website,
  vatNumber: s.vatNumber,
  cocNumber: s.cocNumber,
  iban: s.iban,
  bic: s.bic,
});

export async function billingProfile(tenantId: string) {
  return db.query.tenantBilling.findFirst({ where: eq(schema.tenantBilling.tenantId, tenantId) });
}

async function customerParty(tenantId: string): Promise<BillingParty> {
  const [tenant, profile] = await Promise.all([db.query.tenants.findFirst({ where: eq(schema.tenants.id, tenantId) }), billingProfile(tenantId)]);
  return {
    name: profile?.companyName || tenant?.name || '',
    address: profile?.address ?? '',
    email: profile?.email || tenant?.contactEmail || '',
    vatNumber: profile?.vatNumber ?? '',
    reference: profile?.reference ?? '',
  };
}

/** The billing address, else the customer's admins. */
export async function invoiceRecipients(invoice: Invoice): Promise<string[]> {
  if (invoice.customer.email) return [invoice.customer.email];
  if (!invoice.tenantId) return [];
  const admins = await db.query.users.findMany({
    where: and(eq(schema.users.tenantId, invoice.tenantId), eq(schema.users.role, 'tenant_admin'), eq(schema.users.isActive, true)),
  });
  return admins.map((u) => u.email);
}

// ── Invoices ─────────────────────────────────────────────────────────────────

export type InvoiceInput = {
  lines: InvoiceLine[];
  notes?: string;
  vatRateBp?: number;
  reverseCharge?: boolean;
  periodStart?: string | null;
  periodEnd?: string | null;
};

/** A new draft for a customer; VAT and language come from the customer's billing profile. */
export async function createInvoice(tenantId: string, input: InvoiceInput, source: Invoice['source'] = 'manual') {
  const [s, profile] = await Promise.all([getSettings('billing'), billingProfile(tenantId)]);
  const vatRateBp = input.vatRateBp ?? profile?.vatRateBp ?? s.defaultVatRateBp;
  const reverseCharge = input.reverseCharge ?? profile?.reverseCharge ?? false;
  const [row] = await db
    .insert(schema.invoices)
    .values({
      tenantId,
      source,
      locale: normalizeLocale(profile?.locale) ?? DEFAULT_LOCALE,
      currency: s.currency,
      customer: await customerParty(tenantId),
      lines: input.lines,
      notes: input.notes ?? '',
      vatRateBp,
      reverseCharge,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      payToken: randomToken(24),
      ...invoiceTotals(input.lines, vatRateBp, reverseCharge),
    })
    .returning();
  return row;
}

export async function updateDraft(id: string, input: InvoiceInput) {
  const current = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, id) });
  if (!current) return null;
  if (current.status !== 'draft') throw badRequest('errors.invoiceNotDraft');
  const vatRateBp = input.vatRateBp ?? current.vatRateBp;
  const reverseCharge = input.reverseCharge ?? current.reverseCharge;
  const [row] = await db
    .update(schema.invoices)
    .set({
      lines: input.lines,
      notes: input.notes ?? current.notes,
      vatRateBp,
      reverseCharge,
      periodStart: input.periodStart === undefined ? current.periodStart : input.periodStart,
      periodEnd: input.periodEnd === undefined ? current.periodEnd : input.periodEnd,
      ...invoiceTotals(input.lines, vatRateBp, reverseCharge),
    })
    .where(and(eq(schema.invoices.id, id), eq(schema.invoices.status, 'draft')))
    .returning();
  return row ?? null;
}

/**
 * Issues a draft: gives it the next number, the invoice and due date, and freezes the
 * company and customer details on it. With `send`, it is e-mailed straight away; a failed
 * e-mail does not undo the issue (it can be sent again).
 */
export async function issueInvoice(id: string, opts: { send: boolean }) {
  const s = await getSettings('billing');
  if (!s.companyName) throw badRequest('errors.billingCompany');
  const invoice = await db.transaction(async (tx) => {
    const [draft] = await tx.select().from(schema.invoices).where(and(eq(schema.invoices.id, id), eq(schema.invoices.status, 'draft'))).for('update');
    if (!draft) throw badRequest('errors.invoiceNotDraft');
    if (!draft.lines.length || draft.subtotalCents <= 0) throw badRequest('errors.invoiceEmpty');
    const issueDate = todayIso();
    const customer = draft.tenantId ? await customerParty(draft.tenantId) : draft.customer;
    const [row] = await tx
      .update(schema.invoices)
      .set({
        number: await nextInvoiceNumber(tx, s, issueDate),
        status: 'open',
        issueDate,
        dueDate: addDays(issueDate, s.paymentTermDays),
        seller: sellerParty(s),
        customer,
      })
      .where(eq(schema.invoices.id, id))
      .returning();
    return row;
  });
  if (!opts.send) return { invoice, sent: false as const };
  try {
    return { invoice: await sendInvoiceMail(invoice, 'invoice'), sent: true as const };
  } catch (err) {
    return { invoice, sent: false as const, error: err };
  }
}

export const payUrl = async (invoice: Pick<Invoice, 'payToken'>) => `${await adminBaseUrl()}/billing/pay/${invoice.payToken}`;
export const invoiceFileName = (invoice: Pick<Invoice, 'number' | 'locale'>) =>
  `${invoice.locale === 'nl' ? 'factuur' : 'invoice'}-${(invoice.number ?? 'draft').replace(/[^\w.-]+/g, '-')}.pdf`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export async function invoiceMailData(invoice: Invoice, locale: Locale) {
  const amount = moneyLabel(locale, invoice.totalCents, invoice.currency);
  const vars = {
    tenantName: invoice.customer.name,
    companyName: invoice.seller?.name ?? '',
    invoiceNumber: invoice.number ?? '',
    amount,
    issueDate: invoice.issueDate ? formatDay(locale, invoice.issueDate) : '',
    dueDate: invoice.dueDate ? formatDay(locale, invoice.dueDate) : '',
    payUrl: await payUrl(invoice),
  };
  const rows: [string, string][] = [
    [t(locale, 'mail.invoiceNumber'), vars.invoiceNumber],
    [t(locale, 'mail.invoiceDate'), vars.issueDate],
    [t(locale, 'mail.invoiceDue'), vars.dueDate],
    [t(locale, 'mail.invoiceAmount'), amount],
  ];
  const data = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:15px;margin:8px 0 16px">${rows
    .map(([l, v]) => `<tr><td style="padding:8px 0;border-bottom:1px solid #DCE1EB;color:#4F5B73">${esc(l)}</td><td style="padding:8px 0;border-bottom:1px solid #DCE1EB;text-align:right;font-weight:700">${esc(v)}</td></tr>`)
    .join('')}</table>`;
  return { vars, raw: { data }, dataText: rows.map(([l, v]) => `${l}: ${v}`).join('\n') };
}

/** E-mails the invoice (or a reminder or payment confirmation) with the PDF attached. */
export async function sendInvoiceMail(invoice: Invoice, kind: Extract<MailKind, 'invoice' | 'invoiceReminder' | 'invoicePaid'>) {
  const smtp = await getSettings('smtp');
  if (!smtp.enabled) throw badRequest('errors.mailDisabled');
  const recipients = await invoiceRecipients(invoice);
  if (!recipients.length) throw badRequest('errors.invoiceNoRecipient');
  const locale = normalizeLocale(invoice.locale) ?? DEFAULT_LOCALE;
  const data = await invoiceMailData(invoice, locale);
  const pdf = await renderInvoicePdf(invoice, { payUrl: data.vars.payUrl });
  const attachment = { filename: invoiceFileName(invoice), content: pdf, contentType: 'application/pdf' };
  for (const to of recipients) await sendTemplate(to, kind, locale, null, data, [attachment]);
  const patch =
    kind === 'invoice'
      ? { sentAt: new Date() }
      : kind === 'invoiceReminder'
        ? { remindersSent: invoice.remindersSent + 1, lastReminderAt: new Date() }
        : {};
  if (!Object.keys(patch).length) return invoice;
  const [row] = await db.update(schema.invoices).set(patch).where(eq(schema.invoices.id, invoice.id)).returning();
  return row;
}

/** Marks an open invoice paid (once), confirms it by e-mail and lifts a portal pause when nothing is overdue anymore. */
export async function markInvoicePaid(id: string, opts: { via: 'online' | 'manual'; notify: boolean }) {
  const [invoice] = await db
    .update(schema.invoices)
    .set({ status: 'paid', paidAt: new Date(), paidVia: opts.via })
    .where(and(eq(schema.invoices.id, id), eq(schema.invoices.status, 'open')))
    .returning();
  if (!invoice) return null;
  if (opts.notify) await sendInvoiceMail(invoice, 'invoicePaid').catch((err) => console.error(`invoice ${invoice.number} paid mail failed:`, (err as Error).message));
  if (invoice.tenantId) await reviewSuspension(invoice.tenantId);
  return invoice;
}

export async function voidInvoice(id: string) {
  const [invoice] = await db.update(schema.invoices).set({ status: 'void' }).where(and(eq(schema.invoices.id, id), eq(schema.invoices.status, 'open'))).returning();
  if (invoice?.tenantId) await reviewSuspension(invoice.tenantId);
  return invoice ?? null;
}

export const isOverdue = (invoice: Pick<Invoice, 'status' | 'dueDate'>, today = todayIso()) => invoice.status === 'open' && Boolean(invoice.dueDate) && invoice.dueDate! < today;

// ── Portal pause for unpaid invoices ─────────────────────────────────────────

/**
 * Pauses the customer's guest portal while an invoice is more than `suspendAfterDays`
 * overdue (when switched on, platform-wide and for this customer), and lifts the pause
 * as soon as that is no longer the case. The customer can still sign in and pay.
 */
export async function reviewSuspension(tenantId: string, settings?: BillingSettings, today = todayIso()) {
  const s = settings ?? (await getSettings('billing'));
  const [tenant, profile] = await Promise.all([db.query.tenants.findFirst({ where: eq(schema.tenants.id, tenantId) }), billingProfile(tenantId)]);
  if (!tenant) return null;
  const cutoff = addDays(today, -s.suspendAfterDays);
  const overdue = await db.query.invoices.findFirst({
    where: and(eq(schema.invoices.tenantId, tenantId), eq(schema.invoices.status, 'open'), lte(schema.invoices.dueDate, cutoff)),
  });
  const suspend = Boolean(overdue) && s.autoSuspend && (profile?.autoSuspend ?? true);
  if (suspend && !tenant.billingSuspendedAt) {
    await db.update(schema.tenants).set({ billingSuspendedAt: new Date() }).where(eq(schema.tenants.id, tenantId));
    return 'suspended' as const;
  }
  if (!suspend && tenant.billingSuspendedAt) {
    await db.update(schema.tenants).set({ billingSuspendedAt: null }).where(eq(schema.tenants.id, tenantId));
    return 'lifted' as const;
  }
  return null;
}

// ── Background job ───────────────────────────────────────────────────────────

/** Creates the invoice for one subscription period and moves the subscription on, once. */
async function invoicePeriod(profile: TenantBilling, s: BillingSettings) {
  const anchor = profile.startDate ?? profile.nextInvoiceDate!;
  const period = billingPeriod(profile.nextInvoiceDate!, profile.interval, anchor);
  // Claim the period first, so a second run cannot invoice it twice
  const [claimed] = await db
    .update(schema.tenantBilling)
    .set({ nextInvoiceDate: period.next, updatedAt: new Date() })
    .where(and(eq(schema.tenantBilling.tenantId, profile.tenantId), eq(schema.tenantBilling.nextInvoiceDate, period.start)))
    .returning();
  if (!claimed) return null;
  const locale = normalizeLocale(profile.locale) ?? DEFAULT_LOCALE;
  const description = `${profile.planName || t(locale, 'invoice.title')} (${formatDay(locale, period.start)} – ${formatDay(locale, period.end)})`;
  let draft: Invoice;
  try {
    draft = await createInvoice(profile.tenantId, { lines: [{ description, quantity: 1, unitCents: profile.priceCents }], periodStart: period.start, periodEnd: period.end }, 'subscription');
  } catch (err) {
    // Give the period back, so the next run tries again
    await db.update(schema.tenantBilling).set({ nextInvoiceDate: period.start }).where(eq(schema.tenantBilling.tenantId, profile.tenantId));
    throw err;
  }
  if (s.autoSend && s.companyName && profile.priceCents > 0) return (await issueInvoice(draft.id, { send: true })).invoice;
  return draft;
}

export async function runBilling(now = new Date()) {
  const s = await getSettings('billing');
  const today = todayIso(now);

  // 1. Subscription invoices for every period that has started (catching up when needed)
  const due = await db
    .select({ profile: schema.tenantBilling })
    .from(schema.tenantBilling)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.tenantBilling.tenantId))
    .where(and(eq(schema.tenantBilling.subscriptionActive, true), isNotNull(schema.tenantBilling.nextInvoiceDate), lte(schema.tenantBilling.nextInvoiceDate, today), eq(schema.tenants.status, 'active')));
  for (const { profile } of due) {
    let current: TenantBilling | undefined = profile;
    for (let i = 0; i < 36 && current?.subscriptionActive && current.nextInvoiceDate && current.nextInvoiceDate <= today; i++) {
      const done = await invoicePeriod(current, s).catch((err) => {
        console.error(`billing for ${profile.tenantId} failed:`, (err as Error).message);
        return null;
      });
      if (!done) break;
      current = await billingProfile(profile.tenantId);
    }
  }

  // 2. Reminders, at most one per day per invoice (waiting while e-mail is not set up)
  const smtp = await getSettings('smtp');
  if (s.reminders && s.reminderDays.length && smtp.enabled) {
    const steps = [...s.reminderDays].sort((a, b) => a - b);
    const overdue = await db.query.invoices.findMany({ where: and(eq(schema.invoices.status, 'open'), lt(schema.invoices.dueDate, today)), orderBy: asc(schema.invoices.dueDate) });
    for (const invoice of overdue) {
      const step = steps[invoice.remindersSent];
      if (step === undefined || daysBetween(invoice.dueDate!, today) < step) continue;
      if (invoice.lastReminderAt && now.getTime() - invoice.lastReminderAt.getTime() < 20 * 3600_000) continue;
      await sendInvoiceMail(invoice, 'invoiceReminder').catch((err) => console.error(`reminder for ${invoice.number} failed:`, (err as Error).message));
    }
  }

  // 3. Pause or resume guest portals
  const candidates = await db
    .selectDistinct({ id: schema.tenants.id })
    .from(schema.tenants)
    .leftJoin(schema.invoices, and(eq(schema.invoices.tenantId, schema.tenants.id), eq(schema.invoices.status, 'open')))
    .where(or(isNotNull(schema.tenants.billingSuspendedAt), isNotNull(schema.invoices.id)));
  for (const { id } of candidates) await reviewSuspension(id, s, today);
}

// ── Online payment with the platform's own Mollie or Stripe account ──────────

/** Creates a checkout for the invoice total and returns where to send the customer. */
export async function startInvoicePayment(invoice: Invoice, base: string) {
  if (invoice.status !== 'open') throw badRequest('errors.invoiceNotOpen');
  const s = await getSettings('billing');
  try {
    assertConfigured(s);
  } catch {
    throw badRequest('errors.billingProvider');
  }
  const provider = s.provider as 'mollie' | 'stripe';
  const [attempt] = await db
    .insert(schema.invoicePayments)
    .values({ invoiceId: invoice.id, provider, amountCents: invoice.totalCents, currency: invoice.currency })
    .returning();
  const locale = normalizeLocale(invoice.locale) ?? DEFAULT_LOCALE;
  const returnUrl = `${base}/billing/pay/${invoice.payToken}/return?a=${attempt.id}`;
  const description = `${t(locale, 'invoice.title')} ${invoice.number} - ${s.companyName}`.slice(0, 120);
  try {
    let ref: string;
    let url: string;
    if (provider === 'mollie') {
      const webhookUrl = `${base}/billing/webhooks/mollie`;
      const r = await mollie<{ id: string; _links: { checkout?: { href: string } } }>(s.mollieApiKey, '/payments', {
        amount: { currency: invoice.currency, value: (invoice.totalCents / 100).toFixed(2) },
        description,
        redirectUrl: returnUrl,
        ...(isPublicUrl(webhookUrl) ? { webhookUrl } : {}),
        locale: locale === 'nl' ? 'nl_NL' : 'en_US',
        metadata: { invoiceId: invoice.id, attemptId: attempt.id },
      });
      ref = r.id;
      url = r._links.checkout?.href ?? '';
    } else {
      const r = await stripe<{ id: string; url: string }>(s.stripeSecretKey, '/checkout/sessions', {
        mode: 'payment',
        success_url: returnUrl,
        cancel_url: `${returnUrl}&cancel=1`,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': invoice.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': String(invoice.totalCents),
        'line_items[0][price_data][product_data][name]': description,
        client_reference_id: attempt.id,
        'metadata[invoiceId]': invoice.id,
        'metadata[attemptId]': attempt.id,
        locale: locale === 'nl' ? 'nl' : 'en',
        ...(invoice.customer.email ? { customer_email: invoice.customer.email } : {}),
      });
      ref = r.id;
      url = r.url;
    }
    if (!url) throw new PaymentError('no checkout URL');
    await db.update(schema.invoicePayments).set({ providerRef: ref, checkoutUrl: url }).where(eq(schema.invoicePayments.id, attempt.id));
    return { attempt: { ...attempt, providerRef: ref, checkoutUrl: url }, url };
  } catch (err) {
    await db.update(schema.invoicePayments).set({ status: 'failed' }).where(eq(schema.invoicePayments.id, attempt.id));
    throw err;
  }
}

/** Asks the provider for the status; a paid attempt marks the invoice paid. */
export async function refreshInvoicePayment(attempt: InvoicePayment) {
  if (attempt.status !== 'open' || !attempt.providerRef) return attempt;
  const s = await getSettings('billing');
  let status: InvoicePayment['status'] = 'open';
  if (attempt.provider === 'mollie') {
    if (!s.mollieApiKey) return attempt;
    const r = await mollie<{ status: string }>(s.mollieApiKey, `/payments/${encodeURIComponent(attempt.providerRef)}`);
    status = mollieStatus(r.status);
  } else {
    if (!s.stripeSecretKey) return attempt;
    const r = await stripe<{ status: string; payment_status: string }>(s.stripeSecretKey, `/checkout/sessions/${encodeURIComponent(attempt.providerRef)}`);
    status = r.payment_status === 'paid' ? 'paid' : r.status === 'expired' ? 'expired' : 'open';
  }
  if (status === 'open') return attempt;
  const [row] = await db
    .update(schema.invoicePayments)
    .set({ status, paidAt: status === 'paid' ? new Date() : null })
    .where(and(eq(schema.invoicePayments.id, attempt.id), eq(schema.invoicePayments.status, 'open')))
    .returning();
  if (row?.status === 'paid') await markInvoicePaid(row.invoiceId, { via: 'online', notify: true });
  return row ?? attempt;
}

/** Background job: recent open attempts are checked, for when no webhook arrives; old ones expire. */
export async function pollInvoicePayments() {
  const rows = await db.query.invoicePayments.findMany({
    where: and(eq(schema.invoicePayments.status, 'open'), isNotNull(schema.invoicePayments.providerRef), gt(schema.invoicePayments.createdAt, new Date(Date.now() - 2 * 3600_000))),
  });
  for (const a of rows) await refreshInvoicePayment(a).catch(() => undefined);
  await db
    .update(schema.invoicePayments)
    .set({ status: 'expired' })
    .where(and(eq(schema.invoicePayments.status, 'open'), lt(schema.invoicePayments.createdAt, new Date(Date.now() - 6 * 3600_000))));
}
