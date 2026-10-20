import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { isLocale, locales, normalizeLocale, requestLocale, type Locale } from '../i18n/index.js';
import { audit, requireUser } from '../lib/auth.js';
import { badRequest, forbidden, translateError } from '../lib/errors.js';
import { sendMail } from '../services/mailer.js';
import { defaultMailTemplate, deleteTemplate, effectiveTemplate, findTemplate, mailContentSchema, renderTemplate, saveTemplate } from '../services/mailTemplates.js';
import { reportVars } from '../services/notifications.js';
import { mailKindList, mailKinds, sampleVars, type MailKind } from '../shared/mailDesign.js';

/**
 * E-mail templates. The platform admin edits the templates for all customers; a customer
 * admin edits their own versions of the guest e-mails.
 */
function scope(req: FastifyRequest, kind?: string) {
  const user = requireUser(req);
  if (kind !== undefined && !mailKindList.includes(kind as MailKind)) throw badRequest('errors.mailKind');
  if (user.role === 'superadmin') return { tenantId: null, kinds: mailKindList };
  if (user.role !== 'tenant_admin' || !user.tenantId) throw forbidden();
  const kinds = mailKindList.filter((k) => mailKinds[k].tenant);
  if (kind && !kinds.includes(kind as MailKind)) throw forbidden();
  return { tenantId: user.tenantId, kinds };
}

const localeOf = (v: unknown): Locale => {
  if (!isLocale(v)) throw badRequest('errors.invalidInput', { field: 'locale' });
  return v;
};

/** Example data for the preview, including a real-looking report table. */
function sample(kind: MailKind, locale: Locale): { vars: Record<string, string>; raw: Record<string, string>; dataText: string } {
  if (kind === 'monthlyReport') {
    const byDay = Array.from({ length: 30 }, (_, i) => 20 + Math.round(25 * Math.abs(Math.sin(i / 3))));
    const stats = {
      month: '2026-09', guests: 1284, uniqueDevices: 973, registrations: 412, marketingOptIns: 120, vouchersUsed: 57, payments: 23,
      revenue: [{ currency: 'EUR', cents: 11450 }], byDay, byHour: Array(24).fill(0), byMethod: { free: 700, email: 412, voucher: 57, payment: 23, other: 0 },
      bySite: [{ name: 'Lobby', count: 812 }, { name: 'Terrace', count: 472 }], peakDay: { day: 12, count: 45 }, peakHour: { hour: 14, count: 160 },
      previous: { guests: 1150, uniqueDevices: 901, registrations: 380, payments: 19 },
    };
    const r = reportVars(locale, stats, sampleVars.tenantName, sampleVars.actionUrl);
    return { vars: { ...sampleVars, ...r.vars }, raw: r.raw, dataText: r.dataText };
  }
  if (kind === 'paymentReceipt') {
    const row = (l: string, v: string) => `<tr><td style="padding:8px 0;border-bottom:1px solid #DCE1EB;color:#4F5B73">${l}</td><td style="padding:8px 0;border-bottom:1px solid #DCE1EB;text-align:right;font-weight:700">${v}</td></tr>`;
    const nl = locale === 'nl';
    const data = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:15px;margin:8px 0 16px">${row(nl ? 'Pakket' : 'Package', sampleVars.package)}${row(nl ? 'Bedrag' : 'Amount', sampleVars.amount)}${row(nl ? 'Referentie' : 'Reference', sampleVars.reference)}</table>`;
    return { vars: sampleVars, raw: { data }, dataText: '' };
  }
  return { vars: sampleVars, raw: {}, dataText: '' };
}

export async function mailTemplateRoutes(app: FastifyInstance) {
  app.get('/api/mail-templates', async (req) => {
    const { tenantId, kinds } = scope(req);
    const rows = await db.query.mailTemplates.findMany({ where: tenantId ? eq(schema.mailTemplates.tenantId, tenantId) : undefined });
    const own = rows.filter((r) => r.tenantId === tenantId);
    return {
      templates: kinds.map((kind) => ({
        kind,
        vars: mailKinds[kind].vars,
        data: mailKinds[kind].data,
        custom: Object.fromEntries(Object.keys(locales).map((l) => [l, own.some((r) => r.kind === kind && r.locale === l)])),
        updatedAt: own.filter((r) => r.kind === kind).sort((a, b) => +b.updatedAt - +a.updatedAt)[0]?.updatedAt ?? null,
      })),
    };
  });

  app.get<{ Params: { kind: string }; Querystring: { locale?: string } }>('/api/mail-templates/:kind', async (req) => {
    const { tenantId } = scope(req, req.params.kind);
    const kind = req.params.kind as MailKind;
    const locale = localeOf(req.query.locale);
    const [effective, own] = await Promise.all([effectiveTemplate(kind, locale, tenantId), findTemplate(kind, locale, tenantId)]);
    // What "reset" falls back to: the platform's version for customers, the built-in one for the platform
    const fallback = tenantId ? (await effectiveTemplate(kind, locale, null)).content : defaultMailTemplate(kind, locale);
    return { kind, locale, template: effective.content, source: effective.source, custom: Boolean(own), fallback, vars: mailKinds[kind].vars, data: mailKinds[kind].data, sample: sample(kind, locale) };
  });

  app.put<{ Params: { kind: string } }>('/api/mail-templates/:kind', { bodyLimit: 512_000 }, async (req) => {
    const { tenantId } = scope(req, req.params.kind);
    const body = req.body as { locale?: string };
    const locale = localeOf(body.locale);
    const content = mailContentSchema.parse(req.body);
    await saveTemplate(req.params.kind as MailKind, locale, tenantId, content);
    await audit(req, 'mail.template.updated', { kind: req.params.kind, locale }, tenantId);
    return { ok: true };
  });

  app.delete<{ Params: { kind: string }; Querystring: { locale?: string } }>('/api/mail-templates/:kind', async (req) => {
    const { tenantId } = scope(req, req.params.kind);
    const locale = localeOf(req.query.locale);
    await deleteTemplate(req.params.kind as MailKind, locale, tenantId);
    await audit(req, 'mail.template.reset', { kind: req.params.kind, locale }, tenantId);
    return { ok: true };
  });

  // Sends the template as edited (not yet saved) with example data to the signed-in user
  app.post<{ Params: { kind: string } }>('/api/mail-templates/:kind/test', { bodyLimit: 512_000, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { tenantId } = scope(req, req.params.kind);
    const user = requireUser(req);
    const body = req.body as { locale?: string };
    const locale = localeOf(body.locale);
    const content = mailContentSchema.parse(req.body);
    const kind = req.params.kind as MailKind;
    try {
      const { subject, html, text } = await renderTemplate(kind, locale, tenantId, sample(kind, locale), content);
      await sendMail(user.email, `[Test] ${subject}`, { html, text });
      return { ok: true, to: user.email };
    } catch (err) {
      return { ok: false, error: translateError(err, normalizeLocale(user.locale) ?? requestLocale(req)) };
    }
  });
}
