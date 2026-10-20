/**
 * E-mail templates: either a visual design (blocks, like the portal editor) or raw HTML.
 * Shared by the server (sending) and the admin interface (live preview in the designer).
 * Placeholders: {{name}} inserts a value (escaped); {{{data}}} inserts a prepared HTML
 * fragment such as the report table, and is only available in HTML mode or the data block.
 */

export type MailBlock =
  | { id: string; type: 'heading'; text: string }
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'button'; label: string; url: string }
  | { id: string; type: 'image'; src: string | null; width: number }
  | { id: string; type: 'divider' }
  | { id: string; type: 'spacer'; size: number }
  | { id: string; type: 'data' };

export type MailBlockType = MailBlock['type'];

export type MailTheme = {
  accent: string;
  buttonText: string;
  background: string;
  card: string;
  text: string;
  muted: string;
  logo: string | null;
  logoHeight: number;
  font: 'sans' | 'serif';
  radius: number;
};

export type MailDesign = { version: 1; theme: MailTheme; blocks: MailBlock[] };
export type MailContent = { subject: string; mode: 'visual' | 'html'; design: MailDesign; html: string };

export type MailKind = 'invite' | 'passwordReset' | 'smtpTest' | 'hostnameLive' | 'monthlyReport' | 'invoice' | 'invoiceReminder' | 'invoicePaid' | 'backupFailed' | 'guestWelcome' | 'paymentReceipt';

/** Which templates exist, who may change them and which placeholders they offer. */
export const mailKinds: Record<MailKind, { tenant: boolean; vars: string[]; data: boolean }> = {
  invite: { tenant: false, vars: ['name', 'email', 'actionUrl'], data: false },
  passwordReset: { tenant: false, vars: ['name', 'email', 'actionUrl'], data: false },
  smtpTest: { tenant: false, vars: [], data: false },
  hostnameLive: { tenant: false, vars: ['tenantName', 'hostname', 'portalUrl'], data: false },
  monthlyReport: {
    tenant: false,
    vars: ['tenantName', 'month', 'guests', 'uniqueDevices', 'registrations', 'vouchersUsed', 'payments', 'revenue', 'actionUrl'],
    data: true,
  },
  invoice: { tenant: false, vars: ['tenantName', 'companyName', 'invoiceNumber', 'amount', 'issueDate', 'dueDate', 'payUrl'], data: true },
  invoiceReminder: { tenant: false, vars: ['tenantName', 'companyName', 'invoiceNumber', 'amount', 'issueDate', 'dueDate', 'payUrl'], data: true },
  invoicePaid: { tenant: false, vars: ['tenantName', 'companyName', 'invoiceNumber', 'amount', 'issueDate', 'dueDate', 'payUrl'], data: true },
  backupFailed: { tenant: false, vars: ['name', 'targetName', 'error', 'date', 'actionUrl'], data: false },
  guestWelcome: { tenant: true, vars: ['name', 'email', 'networkName', 'validUntil'], data: false },
  paymentReceipt: { tenant: true, vars: ['name', 'email', 'networkName', 'package', 'amount', 'reference', 'date', 'validUntil'], data: true },
};
export const mailKindList = Object.keys(mailKinds) as MailKind[];

/** Example values for the preview in the designer. */
export const sampleVars: Record<string, string> = {
  name: 'Sam Jansen',
  email: 'sam@example.com',
  actionUrl: 'https://portal.example.com/',
  tenantName: 'Hotel Zeezicht',
  networkName: 'Hotel Zeezicht',
  hostname: 'guest.example.com',
  portalUrl: 'https://guest.example.com/portal/preview',
  month: '09-2026',
  guests: '1.284',
  uniqueDevices: '973',
  registrations: '412',
  vouchersUsed: '57',
  payments: '23',
  revenue: '€ 114,50',
  package: '24 h',
  amount: '€ 4,95',
  reference: 'tr_WDqYK6vllg',
  date: '20-10-2026 14:32',
  validUntil: '21-10-2026 14:32',
  companyName: 'RHIS',
  invoiceNumber: '2026-0042',
  issueDate: '01-11-2026',
  dueDate: '15-11-2026',
  payUrl: 'https://portal.example.com/billing/pay/example',
  targetName: 'NAS (SCP)',
  error: 'Could not connect: connect ETIMEDOUT 192.0.2.10:22',
};

export const defaultMailTheme: MailTheme = {
  accent: '#FF6B57',
  buttonText: '#14213D',
  background: '#F6F7FB',
  card: '#FFFFFF',
  text: '#14213D',
  muted: '#4F5B73',
  logo: null,
  logoHeight: 40,
  font: 'sans',
  radius: 16,
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const color = (v: string, fallback: string) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback);
const fonts = { sans: 'Archivo,Segoe UI,Helvetica,Arial,sans-serif', serif: 'Georgia,Times New Roman,serif' };

/** Replaces {{var}} with plain values (no escaping, for text parts). */
export const fillPlain = (text: string, vars: Record<string, string>) => text.replace(/\{\{\{?\s*(\w+)\s*\}?\}\}/g, (_, k: string) => vars[k] ?? '');

/** Replaces {{var}} (escaped) and {{{var}}} (raw HTML fragment, or escaped value) in HTML. */
export const fillHtml = (html: string, vars: Record<string, string>, raw: Record<string, string> = {}) =>
  html
    .replace(/\{\{\{\s*(\w+)\s*\}\}\}/g, (_, k: string) => raw[k] ?? esc(vars[k] ?? ''))
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => esc(vars[k] ?? ''));

const absolute = (src: string | null, baseUrl: string) => (src && /^\/portal\/media\/[0-9a-f-]{36}$/.test(src) ? `${baseUrl}${src}` : null);
const safeUrl = (u: string) => (/^(https?:\/\/|mailto:)[^\s"'<>]+$/i.test(u) ? u : null);

export type MailRenderInput = {
  vars: Record<string, string>;
  /** Prepared HTML fragments, e.g. { data: '<table>…</table>' }, plus their text versions in dataText. */
  raw?: Record<string, string>;
  dataText?: string;
  baseUrl: string;
  locale: string;
};

const FOOTER = (muted: string, accent: string) =>
  `<p style="font-size:12px;color:${muted};text-align:center;margin:20px 0 0">Designed by <a href="https://rhis.nl" style="color:${accent};text-decoration:none;font-weight:700">RHIS</a></p>`;

export function renderMail(content: MailContent, input: MailRenderInput) {
  const subject = fillPlain(content.subject, input.vars).replace(/[\r\n]+/g, ' ').trim();
  if (content.mode === 'html') {
    let html = fillHtml(content.html, input.vars, input.raw);
    // "Designed by RHIS" is part of every e-mail
    if (!/rhis\.nl/i.test(html)) {
      const footer = FOOTER('#4F5B73', '#B8392A');
      html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${footer}</body>`) : `${html}${footer}`;
    }
    return { subject, html, text: htmlToText(html) };
  }
  const th = { ...defaultMailTheme, ...content.design.theme };
  const c = {
    accent: color(th.accent, defaultMailTheme.accent),
    buttonText: color(th.buttonText, defaultMailTheme.buttonText),
    bg: color(th.background, defaultMailTheme.background),
    card: color(th.card, '#FFFFFF'),
    text: color(th.text, defaultMailTheme.text),
    muted: color(th.muted, defaultMailTheme.muted),
  };
  const radius = Math.max(0, Math.min(32, Number(th.radius) || 0));
  const lines: string[] = [];
  const parts = content.design.blocks.map((b) => {
    switch (b.type) {
      case 'heading': {
        const v = fillPlain(b.text, input.vars);
        lines.push(v, '');
        return `<h1 style="font-size:22px;line-height:1.3;margin:0 0 18px;color:${c.text}">${esc(v)}</h1>`;
      }
      case 'text': {
        const v = fillPlain(b.text, input.vars);
        lines.push(v, '');
        return v
          .split(/\n{2,}/)
          .map((p) => `<p style="margin:0 0 16px;line-height:1.6;color:${c.text}">${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
          .join('');
      }
      case 'button': {
        const url = safeUrl(fillPlain(b.url, input.vars).trim());
        const label = fillPlain(b.label, input.vars);
        if (!url || !label) return '';
        lines.push(`${label}: ${url}`, '');
        return `<p style="margin:24px 0"><a href="${esc(url)}" style="background:${c.accent};color:${c.buttonText};text-decoration:none;font-weight:700;padding:12px 22px;border-radius:${Math.min(radius, 12)}px;display:inline-block">${esc(label)}</a></p>`;
      }
      case 'image': {
        const src = absolute(b.src, input.baseUrl);
        if (!src) return '';
        return `<p style="margin:0 0 16px"><img src="${esc(src)}" alt="" width="${Math.max(40, Math.min(496, Number(b.width) || 496))}" style="max-width:100%;height:auto;border-radius:${Math.min(radius, 12)}px;display:block"></p>`;
      }
      case 'divider':
        return `<hr style="border:0;border-top:1px solid #DCE1EB;margin:20px 0">`;
      case 'spacer':
        return `<div style="height:${Math.max(4, Math.min(80, Number(b.size) || 16))}px"></div>`;
      case 'data':
        if (input.dataText) lines.push(input.dataText, '');
        return input.raw?.data ?? '';
    }
  });
  const logo = absolute(th.logo, input.baseUrl);
  const logoHtml = logo ? `<p style="margin:0 0 20px"><img src="${esc(logo)}" alt="" height="${Math.max(16, Math.min(120, th.logoHeight))}" style="display:block;height:${Math.max(16, Math.min(120, th.logoHeight))}px;width:auto"></p>` : '';
  const html = `<!doctype html><html lang="${esc(input.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${c.bg};font-family:${fonts[th.font] ?? fonts.sans};color:${c.text}">
<div style="max-width:560px;margin:0 auto;padding:32px 16px"><div style="background:${c.card};border:1px solid #DCE1EB;border-radius:${radius}px;padding:32px">
${logoHtml}${parts.join('')}</div>${FOOTER(c.muted, c.accent)}</div></body></html>`;
  return { subject, html, text: [...lines, 'Designed by RHIS - https://rhis.nl'].join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

export function htmlToText(html: string) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => `${label.replace(/<[^>]+>/g, '')} (${href})`)
    .replace(/<(br|\/p|\/h\d|\/tr|\/div|\/li)[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

let n = 0;
export function createMailBlock(type: MailBlockType): MailBlock {
  const id = `m${Date.now().toString(36)}${(n++).toString(36)}`;
  switch (type) {
    case 'heading':
      return { id, type, text: '' };
    case 'text':
      return { id, type, text: '' };
    case 'button':
      return { id, type, label: '', url: '{{actionUrl}}' };
    case 'image':
      return { id, type, src: null, width: 496 };
    case 'spacer':
      return { id, type, size: 16 };
    default:
      return { id, type } as MailBlock;
  }
}
