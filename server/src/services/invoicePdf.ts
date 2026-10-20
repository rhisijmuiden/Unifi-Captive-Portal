import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Invoice } from '../db/schema.js';
import { DEFAULT_LOCALE, normalizeLocale, t, type Locale, type MessageKey, type Params } from '../i18n/index.js';
import { moneyLabel } from '../shared/guestStrings.js';
import { getSettings } from './settings.js';

/**
 * The invoice as an A4 PDF, in the invoice's language. The built-in Helvetica covers
 * Western European text and the euro sign, so no fonts have to be shipped.
 */

const C = { ink: '#14213D', muted: '#4F5B73', line: '#DCE1EB', accent: '#FF6B57', soft: '#F6F7FB', paid: '#1C8A57', void: '#C23434' };
const M = 50;
const W = 595.28 - 2 * M;

// Narrow and non-breaking spaces from Intl are not in the standard PDF fonts
const plain = (s: string) => s.replace(/[  ]/g, ' ');

async function loadLogo(url: string | null) {
  const id = url?.match(/^\/portal\/media\/([0-9a-f-]{36})$/)?.[1];
  if (!id) return null;
  const row = await db.query.media.findFirst({ where: eq(schema.media.id, id) });
  if (!row || !['image/png', 'image/jpeg', 'image/svg+xml'].includes(row.mime)) return null;
  return row;
}

const day = (locale: Locale, iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
};

export async function renderInvoicePdf(invoice: Invoice, opts: { payUrl?: string } = {}): Promise<Buffer> {
  const locale = normalizeLocale(invoice.locale) ?? DEFAULT_LOCALE;
  const tr = (key: string, params?: Params) => plain(t(locale, `invoice.${key}` as MessageKey, params));
  const money = (cents: number) => plain(moneyLabel(locale, cents, invoice.currency));
  const settings = await getSettings('billing');
  // Drafts show the current company details; issued invoices the ones frozen on them
  const seller = invoice.seller ?? { name: settings.companyName, address: settings.address, email: settings.email, phone: settings.phone, website: settings.website, vatNumber: settings.vatNumber, cocNumber: settings.cocNumber, iban: settings.iban, bic: settings.bic };
  const customer = invoice.customer;
  const logo = await loadLogo(settings.logo);

  const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: `${tr('title')} ${invoice.number ?? ''}`.trim(), Author: seller.name } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // Header: logo (or company name) left, title right
  let y = M;
  if (logo?.mime === 'image/svg+xml') {
    SVGtoPDF(doc, logo.data.toString('utf8'), M, y, { width: 170, height: 50, preserveAspectRatio: 'xMinYMin meet' });
  } else if (logo) {
    doc.image(logo.data, M, y, { fit: [170, 50] });
  } else {
    doc.font('Helvetica-Bold').fontSize(18).fillColor(C.ink).text(plain(seller.name), M, y + 12, { width: 260 });
  }
  doc.font('Helvetica-Bold').fontSize(26).fillColor(C.ink).text(tr('title').toUpperCase(), M, y, { width: W, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor(C.muted).text(invoice.number ?? tr('draft'), M, y + 32, { width: W, align: 'right' });
  y += 72;
  doc.moveTo(M, y).lineTo(M + W, y).lineWidth(2).strokeColor(C.accent).stroke();
  y += 18;

  // Customer (left) and company (right)
  const half = W / 2 - 10;
  const block = (x: number, top: number, title: string | null, lines: string[], bold: string) => {
    let yy = top;
    if (title) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted).text(title.toUpperCase(), x, yy, { width: half, characterSpacing: 0.8 });
      yy += 14;
    }
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text(plain(bold), x, yy, { width: half });
    yy = doc.y + 2;
    doc.font('Helvetica').fontSize(9.5).fillColor(C.ink);
    for (const l of lines.filter(Boolean)) {
      doc.text(plain(l), x, yy, { width: half });
      yy = doc.y + 1;
    }
    return yy;
  };
  const customerLines = [...customer.address.split('\n'), customer.vatNumber ? `${tr('customerVat')}: ${customer.vatNumber}` : ''];
  const sellerLines = [
    ...seller.address.split('\n'),
    seller.email ?? '',
    seller.phone ?? '',
    seller.website ?? '',
    seller.vatNumber ? `${tr('vatNumber')}: ${seller.vatNumber}` : '',
    seller.cocNumber ? `${tr('cocNumber')}: ${seller.cocNumber}` : '',
    seller.iban ? `${tr('iban')}: ${seller.iban}${seller.bic ? ` · ${tr('bic')}: ${seller.bic}` : ''}` : '',
  ];
  const leftEnd = block(M, y, null, customerLines, customer.name);
  const rightEnd = block(M + W / 2 + 10, y, null, sellerLines, seller.name);
  y = Math.max(leftEnd, rightEnd) + 18;

  // Invoice details
  const meta: [string, string][] = [
    [tr('number'), invoice.number ?? tr('draft')],
    [tr('date'), invoice.issueDate ? day(locale, invoice.issueDate) : '—'],
    [tr('due'), invoice.dueDate ? day(locale, invoice.dueDate) : '—'],
  ];
  if (invoice.periodStart && invoice.periodEnd) meta.push([tr('period'), `${day(locale, invoice.periodStart)} – ${day(locale, invoice.periodEnd)}`]);
  if (customer.reference) meta.push([tr('reference'), customer.reference]);
  doc.roundedRect(M, y, W, 14 + meta.length * 16, 8).fill(C.soft);
  let my = y + 8;
  for (const [label, value] of meta) {
    doc.font('Helvetica').fontSize(9.5).fillColor(C.muted).text(label, M + 14, my, { width: 140 });
    doc.font('Helvetica-Bold').fillColor(C.ink).text(plain(value), M + 160, my, { width: W - 174 });
    my += 16;
  }
  y = my + 20;

  // Lines
  const cols = { desc: M, qty: M + W - 210, unit: M + W - 160, amount: M + W - 80 };
  const header = (top: number) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted);
    doc.text(tr('description').toUpperCase(), cols.desc, top, { width: cols.qty - cols.desc - 10, characterSpacing: 0.6 });
    doc.text(tr('quantity').toUpperCase(), cols.qty, top, { width: 40, align: 'right', characterSpacing: 0.6 });
    doc.text(tr('unitPrice').toUpperCase(), cols.unit, top, { width: 70, align: 'right', characterSpacing: 0.6 });
    doc.text(tr('amount').toUpperCase(), cols.amount, top, { width: 80, align: 'right', characterSpacing: 0.6 });
    doc.moveTo(M, top + 14).lineTo(M + W, top + 14).lineWidth(0.8).strokeColor(C.ink).stroke();
    return top + 22;
  };
  y = header(y);
  for (const line of invoice.lines) {
    doc.font('Helvetica').fontSize(10);
    const h = doc.heightOfString(plain(line.description), { width: cols.qty - cols.desc - 10 });
    if (y + h > 841.89 - M - 120) {
      doc.addPage();
      y = header(M);
    }
    doc.fillColor(C.ink).text(plain(line.description), cols.desc, y, { width: cols.qty - cols.desc - 10 });
    doc.text(new Intl.NumberFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', { maximumFractionDigits: 2 }).format(line.quantity), cols.qty, y, { width: 40, align: 'right' });
    doc.text(money(line.unitCents), cols.unit, y, { width: 70, align: 'right' });
    doc.text(money(Math.round(line.quantity * line.unitCents)), cols.amount, y, { width: 80, align: 'right' });
    y += Math.max(h, 12) + 8;
    doc.moveTo(M, y - 4).lineTo(M + W, y - 4).lineWidth(0.5).strokeColor(C.line).stroke();
  }

  // Totals
  y += 8;
  const rate = `${new Intl.NumberFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', { maximumFractionDigits: 2 }).format(invoice.vatRateBp / 100)}%`;
  const totals: [string, string, boolean][] = [
    [tr('subtotal'), money(invoice.subtotalCents), false],
    [invoice.reverseCharge ? tr('reverseCharge') : tr('vat', { rate }), money(invoice.vatCents), false],
    [tr('total'), money(invoice.totalCents), true],
  ];
  for (const [label, value, strong] of totals) {
    if (strong) {
      doc.roundedRect(M + W - 240, y - 6, 240, 26, 6).fill(C.ink);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#FFFFFF');
      doc.text(label, M + W - 228, y, { width: 120 });
      doc.text(value, M + W - 130, y, { width: 118, align: 'right' });
      y += 30;
    } else {
      doc.font('Helvetica').fontSize(10).fillColor(C.muted).text(label, M + W - 228, y, { width: 120 });
      doc.fillColor(C.ink).text(value, M + W - 130, y, { width: 118, align: 'right' });
      y += 18;
    }
  }

  // Status stamp
  const stamp = invoice.status === 'paid' && invoice.paidAt ? { text: tr('paid', { date: day(locale, invoice.paidAt.toISOString().slice(0, 10)) }), color: C.paid } : invoice.status === 'void' ? { text: tr('void'), color: C.void } : invoice.status === 'draft' ? { text: tr('draft'), color: C.muted } : null;
  if (stamp) {
    doc.save().rotate(-8, { origin: [M + 90, y - 50] });
    doc.roundedRect(M, y - 68, 200, 34, 6).lineWidth(2).strokeColor(stamp.color).stroke();
    doc.font('Helvetica-Bold').fontSize(13).fillColor(stamp.color).text(stamp.text.toUpperCase(), M, y - 58, { width: 200, align: 'center' });
    doc.restore();
  }

  // Notes and payment instructions
  y += 16;
  const para = (text: string, color = C.ink, size = 9.5) => {
    doc.font('Helvetica').fontSize(size).fillColor(color).text(plain(text), M, y, { width: W });
    y = doc.y + 6;
  };
  if (invoice.reverseCharge) para(tr('reverseChargeNote'), C.muted, 8.5);
  if (invoice.notes) para(invoice.notes);
  if (invoice.status === 'open' && invoice.dueDate) {
    para(`${tr('payBefore', { date: day(locale, invoice.dueDate) })}${seller.iban ? ` ${tr('payTo', { iban: seller.iban, name: seller.name })}` : ''}, ${tr('payQuote', { number: invoice.number ?? '' })}`);
    if (opts.payUrl && settings.provider !== 'none') para(tr('payOnline', { url: opts.payUrl }), C.muted, 8.5);
  }

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing below the bottom margin would otherwise start a new page
    doc.page.margins.bottom = 0;
    const fy = 841.89 - M + 10;
    doc.moveTo(M, fy - 8).lineTo(M + W, fy - 8).lineWidth(0.5).strokeColor(C.line).stroke();
    const footer = [settings.footer, [seller.name, seller.vatNumber && `${tr('vatNumber')} ${seller.vatNumber}`, seller.cocNumber && `${tr('cocNumber')} ${seller.cocNumber}`].filter(Boolean).join(' · ')].filter(Boolean).join('  —  ');
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(plain(footer), M, fy, { width: W - 80, lineBreak: false, height: 10, ellipsis: true });
    doc.text(tr('page', { page: i + 1, pages: range.count }), M + W - 80, fy, { width: 80, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}
