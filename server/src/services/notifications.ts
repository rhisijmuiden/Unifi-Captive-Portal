import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Hostname } from '../db/schema.js';
import { DEFAULT_LOCALE, normalizeLocale, t, type Locale } from '../i18n/index.js';
import { moneyLabel } from '../shared/guestStrings.js';
import type { MailKind } from '../shared/mailDesign.js';
import { renderTemplate, sendTemplate } from './mailTemplates.js';
import { sendMail } from './mailer.js';
import { monthlyStats, previousMonth, TIME_ZONE, type MonthlyStats } from './reports.js';
import { adminBaseUrl, getSettings } from './settings.js';
import { getTenantSettings } from './tenantSettings.js';

/**
 * E-mail notifications for customers: hostname live (A record validated and SSL issued),
 * the monthly report, and the e-mails guests receive. Each notification is logged once,
 * so a restart or a second check never sends it twice.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const formatDateTime = (locale: Locale, d: Date) =>
  new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: TIME_ZONE }).format(d);

export const formatMonth = (locale: Locale, month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, 15));
};

export type Recipient = { email: string; locale: Locale };

/** Customer admins (in their own language) plus the extra addresses in the notification settings. */
export async function tenantRecipients(tenantId: string): Promise<Recipient[]> {
  const settings = await getTenantSettings(tenantId, 'notifications');
  const list = new Map<string, Recipient>();
  if (settings.notifyAdmins) {
    const admins = await db.query.users.findMany({ where: and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, 'tenant_admin'), eq(schema.users.isActive, true)) });
    for (const u of admins) list.set(u.email.toLowerCase(), { email: u.email, locale: normalizeLocale(u.locale) ?? DEFAULT_LOCALE });
  }
  for (const email of settings.recipients) if (!list.has(email.toLowerCase())) list.set(email.toLowerCase(), { email, locale: DEFAULT_LOCALE });
  return [...list.values()];
}

/**
 * Claims a notification: true when it was never sent (or failed before), so this call
 * should send it. The unique (tenant, kind, ref) row is the lock.
 */
async function claim(tenantId: string, kind: string, ref: string) {
  const { rows } = await db.execute(sql`
    insert into notification_log (tenant_id, kind, ref, status) values (${tenantId}, ${kind}, ${ref}, 'sending')
    on conflict (tenant_id, kind, ref) do update set status = 'sending', created_at = now()
      where notification_log.status = 'failed'
    returning id`);
  return rows.length > 0;
}

async function finish(tenantId: string, kind: string, ref: string, status: 'sent' | 'failed' | 'skipped', recipients: string[], error?: string) {
  await db
    .update(schema.notificationLog)
    .set({ status, recipients, error: error ?? null })
    .where(and(eq(schema.notificationLog.tenantId, tenantId), eq(schema.notificationLog.kind, kind), eq(schema.notificationLog.ref, ref)));
}

async function sendToAll(recipients: Recipient[], kind: MailKind, tenantId: string, data: (locale: Locale) => Parameters<typeof sendTemplate>[4]) {
  const errors: string[] = [];
  for (const r of recipients) {
    try {
      await sendTemplate(r.email, kind, r.locale, tenantId, data(r.locale));
    } catch (err) {
      errors.push(`${r.email}: ${(err as Error).message}`);
    }
  }
  return errors;
}

export async function deliver(tenantId: string, kind: MailKind, ref: string, data: (locale: Locale) => Parameters<typeof sendTemplate>[4]) {
  if (!(await claim(tenantId, kind, ref))) return { status: 'duplicate' as const };
  const smtp = await getSettings('smtp');
  const recipients = await tenantRecipients(tenantId);
  const emails = recipients.map((r) => r.email);
  if (!smtp.enabled || !recipients.length) {
    await finish(tenantId, kind, ref, 'skipped', emails, !smtp.enabled ? 'smtp disabled' : 'no recipients');
    return { status: 'skipped' as const };
  }
  const errors = await sendToAll(recipients, kind, tenantId, data);
  const failed = errors.length === recipients.length;
  await finish(tenantId, kind, ref, failed ? 'failed' : 'sent', emails, errors.join('; ') || undefined);
  return { status: failed ? ('failed' as const) : ('sent' as const), errors };
}

// ── Hostname live ────────────────────────────────────────────────────────────

/** Called once a hostname becomes active: DNS validated and the certificate issued. */
export async function notifyHostnameLive(h: Hostname) {
  const settings = await getTenantSettings(h.tenantId, 'notifications');
  if (!settings.hostnameLive) return { status: 'disabled' as const };
  const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, h.tenantId) });
  return deliver(h.tenantId, 'hostnameLive', h.id, () => ({
    vars: { tenantName: tenant?.name ?? '', hostname: h.hostname, portalUrl: `https://${h.hostname}/portal/preview` },
  }));
}

// ── Monthly report ───────────────────────────────────────────────────────────

const delta = (now: number, before: number) => (before ? `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}%` : '');

export function reportVars(locale: Locale, stats: MonthlyStats, tenantName: string, actionUrl: string) {
  const revenue = stats.revenue.length ? stats.revenue.map((r) => moneyLabel(locale, r.cents, r.currency)).join(' + ') : moneyLabel(locale, 0, 'EUR');
  const num = (v: number) => new Intl.NumberFormat(locale === 'nl' ? 'nl-NL' : 'en-GB').format(v);
  const vars = {
    tenantName,
    month: formatMonth(locale, stats.month),
    guests: num(stats.guests),
    uniqueDevices: num(stats.uniqueDevices),
    registrations: num(stats.registrations),
    vouchersUsed: num(stats.vouchersUsed),
    payments: num(stats.payments),
    revenue,
    actionUrl,
  };
  const m = (k: string, p?: Record<string, string>) => t(locale, `mail.${k}` as Parameters<typeof t>[1], p);
  const rows: [string, string, string][] = [
    [m('reportGuests'), vars.guests, delta(stats.guests, stats.previous.guests)],
    [m('reportDevices'), vars.uniqueDevices, delta(stats.uniqueDevices, stats.previous.uniqueDevices)],
    [m('reportRegistrations'), vars.registrations, delta(stats.registrations, stats.previous.registrations)],
    [m('reportVouchers'), vars.vouchersUsed, ''],
    [m('reportPayments'), vars.payments, delta(stats.payments, stats.previous.payments)],
    [m('reportRevenue'), revenue, ''],
  ];
  if (stats.peakDay) {
    const [y, mo] = stats.month.split('-').map(Number);
    const day = new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(Date.UTC(y, mo - 1, stats.peakDay.day));
    rows.push([m('reportPeakDay'), `${day} (${num(stats.peakDay.count)})`, '']);
  }
  if (stats.peakHour) rows.push([m('reportPeakHour'), `${String(stats.peakHour.hour).padStart(2, '0')}:00–${String(stats.peakHour.hour + 1).padStart(2, '0')}:00`, '']);
  const max = Math.max(1, ...stats.byDay);
  const bars = stats.byDay
    .map((c) => `<td valign="bottom" style="padding:0 1px"><div style="height:${Math.max(2, Math.round((c / max) * 60))}px;background:#FF6B57;border-radius:2px 2px 0 0"></div></td>`)
    .join('');
  const table = rows
    .map(
      ([label, value, change]) =>
        `<tr><td style="padding:10px 0;border-bottom:1px solid #DCE1EB;color:#4F5B73">${esc(label)}</td><td style="padding:10px 0;border-bottom:1px solid #DCE1EB;text-align:right;font-weight:700">${esc(value)}${
          change ? ` <span style="font-weight:400;font-size:12px;color:${change.startsWith('-') ? '#C23434' : '#1C8A57'}">${esc(change)}</span>` : ''
        }</td></tr>`,
    )
    .join('');
  const sites = stats.bySite.length > 1 ? `<p style="margin:20px 0 6px;font-weight:700">${esc(m('reportSites'))}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px">${stats.bySite.map((s) => `<tr><td style="padding:6px 0;color:#4F5B73">${esc(s.name)}</td><td style="padding:6px 0;text-align:right">${num(s.count)}</td></tr>`).join('')}</table>` : '';
  const data = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:15px;margin:8px 0 16px">${table}</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="height:64px;margin:8px 0 4px;table-layout:fixed"><tr>${bars}</tr></table>${sites}`;
  const dataText = rows.map(([l, v, c]) => `${l}: ${v}${c ? ` (${c})` : ''}`).join('\n');
  return { vars, raw: { data }, dataText };
}

export async function sendMonthlyReport(tenantId: string, month: string, opts: { force?: boolean; to?: Recipient } = {}) {
  const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, tenantId) });
  if (!tenant) return { status: 'skipped' as const };
  const stats = await monthlyStats(tenantId, month);
  const actionUrl = `${await adminBaseUrl()}/reports?month=${month}`;
  const data = (locale: Locale) => reportVars(locale, stats, tenant.name, actionUrl);
  if (opts.to) {
    await sendTemplate(opts.to.email, 'monthlyReport', opts.to.locale, tenantId, data(opts.to.locale));
    return { status: 'sent' as const };
  }
  return deliver(tenantId, 'monthlyReport', month, data);
}

/** Background job: on the first days of a month every customer gets last month's report, once. */
export async function runMonthlyReports(now = new Date()) {
  const month = previousMonth(now);
  const tenants = await db.query.tenants.findMany({ where: eq(schema.tenants.status, 'active') });
  for (const tenant of tenants) {
    const settings = await getTenantSettings(tenant.id, 'notifications');
    if (!settings.monthlyReport) continue;
    const hasConsole = await db.query.consoles.findFirst({ where: eq(schema.consoles.tenantId, tenant.id) });
    if (!hasConsole) continue;
    await sendMonthlyReport(tenant.id, month);
  }
}

// ── Guest e-mails ────────────────────────────────────────────────────────────

/** Welcome and receipt e-mails to guests; never throws, a failed e-mail must not block access. */
export async function sendGuestMail(
  kind: Extract<MailKind, 'guestWelcome' | 'paymentReceipt' | 'guestPrivacy'>,
  tenantId: string,
  to: string,
  locale: Locale,
  input: { name: string; email: string; validUntil: Date | null; actionUrl?: string; package?: string; amount?: string; reference?: string; date?: Date; rows?: [string, string][] },
) {
  try {
    const smtp = await getSettings('smtp');
    if (!smtp.enabled) return false;
    const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, tenantId) });
    const vars: Record<string, string> = {
      name: input.name || to.split('@')[0],
      email: input.email,
      networkName: tenant?.name ?? '',
      validUntil: input.validUntil ? formatDateTime(locale, input.validUntil) : '—',
      package: input.package ?? '',
      actionUrl: input.actionUrl ?? '',
      amount: input.amount ?? '',
      reference: input.reference ?? '',
      date: formatDateTime(locale, input.date ?? new Date()),
    };
    const rows = [...(input.rows ?? []), ...(input.date ? [[t(locale, 'mail.receiptDate'), vars.date] as [string, string]] : [])];
    const data = rows.length
      ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:15px;margin:8px 0 16px">${rows
          .map(([l, v]) => `<tr><td style="padding:8px 0;border-bottom:1px solid #DCE1EB;color:#4F5B73">${esc(l)}</td><td style="padding:8px 0;border-bottom:1px solid #DCE1EB;text-align:right;font-weight:700">${esc(v)}</td></tr>`)
          .join('')}</table>`
      : '';
    const { subject, html, text } = await renderTemplate(kind, locale, tenantId, { vars, raw: { data }, dataText: rows.map(([l, v]) => `${l}: ${v}`).join('\n') });
    await sendMail(to, subject, { html, text });
    return true;
  } catch (err) {
    console.error(`guest mail ${kind} to ${to} failed:`, (err as Error).message);
    return false;
  }
}
