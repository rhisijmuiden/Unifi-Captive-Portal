import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { t, type Locale, type MessageKey } from '../i18n/index.js';
import type { NoId } from '../shared/portalDesign.js';
import { createMailBlock, defaultMailTheme, mailKinds, renderMail, type MailBlock, type MailContent, type MailKind } from '../shared/mailDesign.js';
import { sendMail, type MailAttachment } from './mailer.js';
import { adminBaseUrl } from './settings.js';
import { designedByFor, resellerOfUser } from './resellers.js';
import type { User } from '../db/schema.js';

/**
 * E-mail templates. Every e-mail has a built-in default (from the translations), which
 * the platform admin can replace for all customers, and customers can replace the
 * guest e-mails (welcome, receipt) with their own version.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'errors.colorFormat');
const mediaSrc = z.string().regex(/^\/portal\/media\/[0-9a-f-]{36}$/).nullable();
const short = z.string().max(5000);

export const mailBlockSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().max(40), type: z.literal('heading'), text: short }),
  z.object({ id: z.string().max(40), type: z.literal('text'), text: short }),
  z.object({ id: z.string().max(40), type: z.literal('button'), label: z.string().max(200), url: z.string().max(2000) }),
  z.object({ id: z.string().max(40), type: z.literal('image'), src: mediaSrc, width: z.number().int().min(40).max(496) }),
  z.object({ id: z.string().max(40), type: z.literal('divider') }),
  z.object({ id: z.string().max(40), type: z.literal('spacer'), size: z.number().int().min(4).max(80) }),
  z.object({ id: z.string().max(40), type: z.literal('data') }),
]);

export const mailContentSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  mode: z.enum(['visual', 'html']),
  design: z.object({
    version: z.literal(1),
    theme: z.object({
      accent: hex,
      buttonText: hex,
      background: hex,
      card: hex,
      text: hex,
      muted: hex,
      logo: mediaSrc,
      logoHeight: z.number().int().min(16).max(120),
      font: z.enum(['sans', 'serif']),
      radius: z.number().int().min(0).max(32),
    }),
    blocks: z.array(mailBlockSchema).max(40),
  }),
  html: z.string().max(200_000),
});

const block = (b: NoId<MailBlock>, i: number) => ({ ...b, id: `d${i}` }) as MailBlock;

/** The built-in template, written from the translations. */
export function defaultMailTemplate(kind: MailKind, locale: Locale): MailContent {
  const m = (key: string) => t(locale, `mail.${key}` as MessageKey);
  const spec: Record<MailKind, { subject: string; blocks: NoId<MailBlock>[] }> = {
    invite: {
      subject: m('inviteSubject'),
      blocks: [
        { type: 'heading', text: m('inviteTitle') },
        { type: 'text', text: m('inviteBody') },
        { type: 'button', label: m('inviteButton'), url: '{{actionUrl}}' },
      ],
    },
    passwordReset: {
      subject: m('resetSubject'),
      blocks: [
        { type: 'heading', text: m('resetTitle') },
        { type: 'text', text: m('resetBody') },
        { type: 'button', label: m('resetButton'), url: '{{actionUrl}}' },
      ],
    },
    smtpTest: { subject: m('testSubject'), blocks: [{ type: 'heading', text: m('testTitle') }, { type: 'text', text: m('testBody') }] },
    hostnameLive: {
      subject: m('hostnameLiveSubject'),
      blocks: [
        { type: 'heading', text: m('hostnameLiveTitle') },
        { type: 'text', text: m('hostnameLiveBody') },
        { type: 'button', label: m('hostnameLiveButton'), url: '{{portalUrl}}' },
      ],
    },
    monthlyReport: {
      subject: m('reportSubject'),
      blocks: [
        { type: 'heading', text: m('reportTitle') },
        { type: 'text', text: m('reportBody') },
        { type: 'data' },
        { type: 'button', label: m('reportButton'), url: '{{actionUrl}}' },
      ],
    },
    invoice: {
      subject: m('invoiceSubject'),
      blocks: [
        { type: 'heading', text: m('invoiceTitle') },
        { type: 'text', text: m('invoiceBody') },
        { type: 'data' },
        { type: 'button', label: m('invoiceButton'), url: '{{payUrl}}' },
        { type: 'text', text: m('invoiceAttached') },
      ],
    },
    invoiceReminder: {
      subject: m('reminderSubject'),
      blocks: [
        { type: 'heading', text: m('reminderTitle') },
        { type: 'text', text: m('reminderBody') },
        { type: 'data' },
        { type: 'button', label: m('invoiceButton'), url: '{{payUrl}}' },
        { type: 'text', text: m('reminderIgnore') },
      ],
    },
    invoicePaid: {
      subject: m('invoicePaidSubject'),
      blocks: [
        { type: 'heading', text: m('invoicePaidTitle') },
        { type: 'text', text: m('invoicePaidBody') },
        { type: 'data' },
      ],
    },
    backupFailed: {
      subject: m('backupFailedSubject'),
      blocks: [
        { type: 'heading', text: m('backupFailedTitle') },
        { type: 'text', text: m('backupFailedBody') },
        { type: 'text', text: '{{error}}' },
        { type: 'button', label: m('backupFailedButton'), url: '{{actionUrl}}' },
      ],
    },
    consoleOffline: {
      subject: m('consoleOfflineSubject'),
      blocks: [
        { type: 'heading', text: m('consoleOfflineTitle') },
        { type: 'text', text: m('consoleOfflineBody') },
        { type: 'text', text: '{{error}}' },
        { type: 'button', label: m('monitoringButton'), url: '{{actionUrl}}' },
      ],
    },
    consoleOnline: {
      subject: m('consoleOnlineSubject'),
      blocks: [
        { type: 'heading', text: m('consoleOnlineTitle') },
        { type: 'text', text: m('consoleOnlineBody') },
        { type: 'button', label: m('monitoringButton'), url: '{{actionUrl}}' },
      ],
    },
    deviceOffline: {
      subject: m('deviceOfflineSubject'),
      blocks: [
        { type: 'heading', text: m('deviceOfflineTitle') },
        { type: 'text', text: m('deviceOfflineBody') },
        { type: 'button', label: m('monitoringButton'), url: '{{actionUrl}}' },
      ],
    },
    deviceOnline: {
      subject: m('deviceOnlineSubject'),
      blocks: [
        { type: 'heading', text: m('deviceOnlineTitle') },
        { type: 'text', text: m('deviceOnlineBody') },
        { type: 'button', label: m('monitoringButton'), url: '{{actionUrl}}' },
      ],
    },
    guestWelcome: { subject: m('welcomeSubject'), blocks: [{ type: 'heading', text: m('welcomeTitle') }, { type: 'text', text: m('welcomeBody') }] },
    guestPrivacy: {
      subject: m('privacySubject'),
      blocks: [
        { type: 'heading', text: m('privacyTitle') },
        { type: 'text', text: m('privacyBody') },
        { type: 'button', label: m('privacyButton'), url: '{{actionUrl}}' },
        { type: 'text', text: m('privacyIgnore') },
      ],
    },
    paymentReceipt: {
      subject: m('receiptSubject'),
      blocks: [
        { type: 'heading', text: m('receiptTitle') },
        { type: 'text', text: m('receiptBody') },
        { type: 'data' },
        { type: 'text', text: m('receiptKeep') },
      ],
    },
  };
  const { subject, blocks } = spec[kind];
  const design = { version: 1 as const, theme: { ...defaultMailTheme }, blocks: blocks.map(block) };
  return { subject, mode: 'visual', design, html: defaultHtml(design.blocks) };
}

/** Starting point for HTML mode: the same content as plain, editable HTML. */
function defaultHtml(blocks: MailBlock[]) {
  const body = blocks
    .map((b) => {
      if (b.type === 'heading') return `    <h1 style="font-size:22px;margin:0 0 18px">${b.text}</h1>`;
      if (b.type === 'text') return `    <p style="margin:0 0 16px;line-height:1.6">${b.text}</p>`;
      if (b.type === 'button')
        return `    <p style="margin:24px 0"><a href="${b.url}" style="background:#FF6B57;color:#14213D;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px;display:inline-block">${b.label}</a></p>`;
      if (b.type === 'data') return '    {{{data}}}';
      return '';
    })
    .filter(Boolean)
    .join('\n');
  return `<!doctype html>
<html>
<body style="margin:0;background:#F6F7FB;font-family:Archivo,Segoe UI,Arial,sans-serif;color:#14213D">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
  <div style="background:#ffffff;border:1px solid #DCE1EB;border-radius:16px;padding:32px">
${body}
  </div>
  <p style="font-size:12px;color:#4F5B73;text-align:center;margin-top:20px">Designed by <a href="https://rhis.nl" style="color:#B8392A">RHIS</a></p>
  </div>
</body>
</html>`;
}

const scopeWhere = (tenantId: string | null) => (tenantId ? eq(schema.mailTemplates.tenantId, tenantId) : isNull(schema.mailTemplates.tenantId));

export async function findTemplate(kind: MailKind, locale: Locale, tenantId: string | null) {
  return db.query.mailTemplates.findFirst({
    where: and(eq(schema.mailTemplates.kind, kind), eq(schema.mailTemplates.locale, locale), scopeWhere(tenantId)),
  });
}

const toContent = (row: NonNullable<Awaited<ReturnType<typeof findTemplate>>>, fallback: MailContent): MailContent => ({
  subject: row.subject,
  mode: row.mode,
  design: row.design ?? fallback.design,
  html: row.html || fallback.html,
});

/** The template that is used: the customer's own, then the platform's, then the built-in one. */
export async function effectiveTemplate(kind: MailKind, locale: Locale, tenantId: string | null) {
  const builtIn = defaultMailTemplate(kind, locale);
  if (tenantId && mailKinds[kind].tenant) {
    const own = await findTemplate(kind, locale, tenantId);
    if (own) return { content: toContent(own, builtIn), source: 'tenant' as const };
  }
  const platform = await findTemplate(kind, locale, null);
  if (platform) return { content: toContent(platform, builtIn), source: 'platform' as const };
  return { content: builtIn, source: 'default' as const };
}

export async function saveTemplate(kind: MailKind, locale: Locale, tenantId: string | null, content: MailContent) {
  await db.transaction(async (tx) => {
    await tx.delete(schema.mailTemplates).where(and(eq(schema.mailTemplates.kind, kind), eq(schema.mailTemplates.locale, locale), scopeWhere(tenantId)));
    await tx.insert(schema.mailTemplates).values({ kind, locale, tenantId, subject: content.subject, mode: content.mode, design: content.design, html: content.html });
  });
}

export const deleteTemplate = (kind: MailKind, locale: Locale, tenantId: string | null) =>
  db.delete(schema.mailTemplates).where(and(eq(schema.mailTemplates.kind, kind), eq(schema.mailTemplates.locale, locale), scopeWhere(tenantId)));

export type MailData = {
  vars: Record<string, string>;
  raw?: Record<string, string>;
  dataText?: string;
  baseUrl?: string;
  /** Recipient of a platform e-mail, so the e-mail follows the brand of their reseller */
  brandOf?: Pick<User, 'resellerId' | 'tenantId'>;
};

export async function renderTemplate(kind: MailKind, locale: Locale, tenantId: string | null, data: MailData, override?: MailContent) {
  const content = override ?? (await effectiveTemplate(kind, locale, tenantId)).content;
  const designedBy = data.brandOf ? ((await resellerOfUser(data.brandOf))?.showDesignedBy ?? true) : await designedByFor(tenantId);
  return renderMail(content, { ...data, baseUrl: data.baseUrl ?? (await adminBaseUrl()), locale, designedBy });
}

export async function sendTemplate(to: string, kind: MailKind, locale: Locale, tenantId: string | null, data: MailData, attachments?: MailAttachment[]) {
  const { subject, html, text } = await renderTemplate(kind, locale, tenantId, data);
  return sendMail(to, subject, { html, text, attachments });
}

export { createMailBlock };
