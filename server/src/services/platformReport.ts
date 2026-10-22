import PDFDocument from 'pdfkit';
import { TIME_ZONE } from './reports.js';
import { t, type Locale, type MessageKey, type Params } from '../i18n/index.js';
import { moneyLabel } from '../shared/guestStrings.js';
import type { PlatformStats } from './platformStats.js';

/** The platform statistics as a download: CSV for spreadsheets, PDF to read or pass on. */

export type ReportContext = { locale: Locale; scopeLabel: string; generatedAt?: Date };

const C = { ink: '#14213D', muted: '#4F5B73', line: '#DCE1EB', accent: '#FF6B57', soft: '#F6F7FB' };
const M = 44;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const W = PAGE_W - 2 * M;

// Narrow and non-breaking spaces from Intl are not in the standard PDF fonts
const plain = (s: string) => s.replace(/[  ]/g, ' ');
const intl = (locale: Locale) => (locale === 'nl' ? 'nl-NL' : 'en-GB');

export function reportText(locale: Locale) {
  const tr = (key: string, params?: Params) => plain(t(locale, `stats.${key}` as MessageKey, params));
  const num = (v: number) => plain(new Intl.NumberFormat(intl(locale)).format(v));
  const day = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return plain(new Intl.DateTimeFormat(intl(locale), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d)));
  };
  // 2024-01-01 was a Monday
  const weekday = (i: number, style: 'long' | 'short' = 'long') => new Intl.DateTimeFormat(intl(locale), { weekday: style, timeZone: 'UTC' }).format(Date.UTC(2024, 0, 1 + i));
  const change = (now: number, before: number) => (before ? `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}%` : '');
  return { tr, num, day, weekday, change };
}

function summaryRows(s: PlatformStats, locale: Locale): [string, number, number | null][] {
  const { tr } = reportText(locale);
  const p = s.previous;
  return [
    [tr('guests'), s.totals.guests, p.guests],
    [tr('devices'), s.totals.uniqueDevices, p.uniqueDevices],
    [tr('newDevices'), s.totals.newDevices, null],
    [tr('returningDevices'), s.totals.returningDevices, null],
    [tr('registrations'), s.totals.registrations, p.registrations],
    [tr('activeTenants'), s.totals.activeTenants, p.activeTenants],
    [tr('tenants'), s.totals.tenants, null],
    [tr('newTenants'), s.totals.newTenants, null],
    [tr('resellers'), s.totals.resellers, null],
    [tr('activeAdmins'), s.totals.activeAdmins, null],
    [tr('onlineNow'), s.totals.onlineNow, null],
    [tr('vouchers'), s.totals.vouchersUsed, p.vouchersUsed],
    [tr('paidSessions'), s.totals.paidSessions, p.paidSessions],
    [tr('optIns'), s.totals.marketingOptIns, null],
  ];
}

const resellerName = (name: string, locale: Locale) => name || reportText(locale).tr('direct');

/** Spreadsheet-friendly CSV: sections one below the other; Dutch Excel expects a semicolon. */
export function statsCsv(s: PlatformStats, ctx: ReportContext) {
  const { tr, weekday } = reportText(ctx.locale);
  const sep = ctx.locale === 'nl' ? ';' : ',';
  const cell = (v: string | number | null) => {
    const text = v === null ? '' : String(v);
    return /[",;\n\r]/.test(text) || /^[=+\-@]/.test(text) ? `"${text.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : text;
  };
  const lines: string[] = [];
  const row = (...cells: (string | number | null)[]) => lines.push(cells.map(cell).join(sep));
  row(tr('title'));
  row(tr('period'), s.from, s.to);
  row(tr('scope'), ctx.scopeLabel);
  row();
  row(tr('summary'));
  row(tr('metric'), tr('value'), tr('previous'));
  for (const [label, value, before] of summaryRows(s, ctx.locale)) row(label, value, before);
  for (const r of s.totals.guestRevenue) row(`${tr('revenue')} (${r.currency})`, (r.cents / 100).toFixed(2));
  row();
  row(tr('trend'));
  row(tr('bucket'), tr('guests'), tr('devices'), tr('activeTenants'));
  for (const b of s.series) row(b.bucket, b.guests, b.devices, b.tenants);
  row();
  row(tr('heatmap'));
  row(tr('weekday'), ...Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`));
  s.heatmap.forEach((hours, d) => row(weekday(d), ...hours));
  row();
  row(tr('byReseller'));
  row(tr('reseller'), tr('tenants'), tr('activeTenants'), tr('guests'), tr('devices'), tr('previous'));
  for (const r of s.byReseller) row(resellerName(r.name, ctx.locale), r.tenants, r.activeTenants, r.guests, r.devices, r.previousGuests);
  row();
  row(tr('byTenant'));
  row(tr('tenant'), tr('reseller'), tr('guests'), tr('devices'), tr('registrations'), tr('previous'), tr('lastGuest'));
  for (const r of s.byTenant) row(r.name, r.resellerName ?? tr('direct'), r.guests, r.devices, r.registrations, r.previousGuests, r.lastGuestAt);
  row();
  row(tr('byMethod'));
  row(tr('method'), tr('count'));
  for (const [k, v] of Object.entries(s.byMethod)) if (v) row(tr(`methods.${k}`), v);
  // BOM so Excel reads UTF-8
  return `﻿${lines.join('\r\n')}\r\n`;
}

export async function renderStatsPdf(s: PlatformStats, ctx: ReportContext): Promise<Buffer> {
  const { locale } = ctx;
  const { tr, num, day, weekday, change } = reportText(locale);
  const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: `${tr('title')} ${s.from} – ${s.to}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  let y = M;
  const room = (h: number) => {
    if (y + h > PAGE_H - M - 20) {
      doc.addPage();
      y = M;
    }
  };
  const heading = (text: string) => {
    room(60);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(C.ink).text(text, M, y, { width: W });
    y = doc.y + 8;
  };

  // Title
  doc.font('Helvetica-Bold').fontSize(22).fillColor(C.ink).text(tr('title'), M, y, { width: W });
  y = doc.y + 4;
  doc.font('Helvetica').fontSize(10).fillColor(C.muted).text(`${tr('period')}: ${day(s.from)} – ${day(s.to)}  ·  ${tr('scope')}: ${plain(ctx.scopeLabel)}`, M, y, { width: W });
  y = doc.y + 10;
  doc.moveTo(M, y).lineTo(M + W, y).lineWidth(2).strokeColor(C.accent).stroke();
  y += 16;

  // Headline tiles
  const tiles: [string, number, number | null][] = [
    [tr('guests'), s.totals.guests, s.previous.guests],
    [tr('devices'), s.totals.uniqueDevices, s.previous.uniqueDevices],
    [tr('activeTenants'), s.totals.activeTenants, s.previous.activeTenants],
    [tr('onlineNow'), s.totals.onlineNow, null],
  ];
  const tw = (W - 3 * 10) / 4;
  tiles.forEach(([label, value, before], i) => {
    const x = M + i * (tw + 10);
    doc.roundedRect(x, y, tw, 62, 8).fill(C.soft);
    doc.font('Helvetica-Bold').fontSize(18).fillColor(C.ink).text(num(value), x + 10, y + 10, { width: tw - 20 });
    doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(label, x + 10, y + 34, { width: tw - 20 });
    const c = before !== null ? change(value, before) : '';
    if (c) doc.font('Helvetica-Bold').fontSize(7.5).fillColor(c.startsWith('+') ? '#1C8A57' : '#C23434').text(`${c} ${tr('previous').toLowerCase()}`, x + 10, y + 46, { width: tw - 20 });
  });
  y += 80;
  if (s.peak) {
    doc.font('Helvetica').fontSize(9.5).fillColor(C.muted).text(tr('peak', { weekday: weekday(s.peak.weekday), hour: String(s.peak.hour).padStart(2, '0'), next: String((s.peak.hour + 1) % 24).padStart(2, '0'), count: num(s.peak.count) }), M, y, { width: W });
    y = doc.y + 14;
  }

  // Trend as bars
  heading(tr('trend'));
  {
    const h = 130;
    const max = Math.max(1, ...s.series.map((b) => b.guests));
    const bw = W / Math.max(1, s.series.length);
    doc.moveTo(M, y + h).lineTo(M + W, y + h).lineWidth(0.6).strokeColor(C.line).stroke();
    s.series.forEach((b, i) => {
      const bh = (b.guests / max) * (h - 12);
      if (bh > 0) doc.rect(M + i * bw + bw * 0.15, y + h - bh, Math.max(0.8, bw * 0.7), bh).fill(C.accent);
    });
    doc.font('Helvetica').fontSize(7).fillColor(C.muted);
    doc.text(num(max), M, y - 2, { width: 60 });
    const every = Math.max(1, Math.ceil(s.series.length / 6));
    s.series.forEach((b, i) => {
      if (i % every === 0) doc.text(day(b.bucket), M + i * bw, y + h + 4, { width: 80, lineBreak: false });
    });
    y += h + 26;
  }

  // Heatmap weekday × hour
  heading(tr('heatmap'));
  {
    const labelW = 60;
    const cw = (W - labelW) / 24;
    const ch = 16;
    const max = Math.max(1, ...s.heatmap.flat());
    room(7 * ch + 20);
    s.heatmap.forEach((hours, d) => {
      doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(weekday(d, 'short'), M, y + d * ch + 4, { width: labelW - 4 });
      hours.forEach((c, hr) => {
        const x = M + labelW + hr * cw;
        doc.rect(x + 0.5, y + d * ch + 0.5, cw - 1, ch - 1).fillOpacity(c ? 0.12 + 0.88 * (c / max) : 1).fill(c ? C.accent : C.soft);
        doc.fillOpacity(1);
      });
    });
    for (let hr = 0; hr < 24; hr += 3) doc.font('Helvetica').fontSize(7).fillColor(C.muted).text(String(hr).padStart(2, '0'), M + labelW + hr * cw, y + 7 * ch + 3, { width: cw * 3 });
    y += 7 * ch + 22;
  }

  // Tables
  const table = (title: string, cols: { label: string; w: number; align?: 'left' | 'right' }[], rows: string[][]) => {
    heading(title);
    const head = () => {
      let x = M;
      let h = 0;
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.muted);
      // Long labels wrap onto a second line instead of running into the next column
      for (const c of cols) {
        const opts = { width: c.w - 6, align: c.align ?? 'left', characterSpacing: 0.4 } as const;
        doc.text(c.label.toUpperCase(), x, y, opts);
        h = Math.max(h, doc.heightOfString(c.label.toUpperCase(), opts));
        x += c.w;
      }
      y += h + 3;
      doc.moveTo(M, y).lineTo(M + W, y).lineWidth(0.8).strokeColor(C.ink).stroke();
      y += 5;
    };
    head();
    for (const r of rows) {
      if (y + 16 > PAGE_H - M - 20) {
        doc.addPage();
        y = M;
        head();
      }
      let x = M;
      doc.font('Helvetica').fontSize(9).fillColor(C.ink);
      r.forEach((v, i) => {
        doc.text(plain(v), x, y, { width: cols[i].w - 6, align: cols[i].align ?? 'left', lineBreak: false, ellipsis: true, height: 12 });
        x += cols[i].w;
      });
      y += 14;
      doc.moveTo(M, y - 3).lineTo(M + W, y - 3).lineWidth(0.4).strokeColor(C.line).stroke();
    }
    y += 14;
  };

  table(
    tr('summary'),
    [
      { label: tr('metric'), w: W - 240 },
      { label: tr('value'), w: 80, align: 'right' },
      { label: tr('previous'), w: 80, align: 'right' },
      { label: tr('change'), w: 80, align: 'right' },
    ],
    [
      ...summaryRows(s, locale).map(([label, v, before]) => [label, num(v), before === null ? '' : num(before), before === null ? '' : change(v, before)]),
      ...s.totals.guestRevenue.map((r) => [`${tr('revenue')} (${r.currency})`, plain(moneyLabel(locale, r.cents, r.currency)), '', '']),
    ],
  );

  if (s.byReseller.length)
    table(
      tr('byReseller'),
      [
        { label: tr('reseller'), w: W - 330 },
        { label: tr('tenants'), w: 60, align: 'right' },
        { label: tr('activeTenants'), w: 70, align: 'right' },
        { label: tr('guestsShort'), w: 70, align: 'right' },
        { label: tr('devicesShort'), w: 70, align: 'right' },
        { label: tr('change'), w: 60, align: 'right' },
      ],
      s.byReseller.map((r) => [resellerName(r.name, locale), num(r.tenants), num(r.activeTenants), num(r.guests), num(r.devices), change(r.guests, r.previousGuests)]),
    );

  const shown = s.byTenant.filter((r) => r.guests || r.previousGuests).slice(0, 100);
  if (shown.length)
    table(
      tr('byTenant'),
      [
        { label: tr('tenant'), w: W - 350 },
        { label: tr('reseller'), w: 100 },
        { label: tr('guestsShort'), w: 60, align: 'right' },
        { label: tr('devicesShort'), w: 60, align: 'right' },
        { label: tr('registrations'), w: 70, align: 'right' },
        { label: tr('change'), w: 60, align: 'right' },
      ],
      shown.map((r) => [r.name, r.resellerName ?? tr('direct'), num(r.guests), num(r.devices), num(r.registrations), change(r.guests, r.previousGuests)]),
    );

  const methods = Object.entries(s.byMethod).filter(([, v]) => v);
  if (methods.length)
    table(
      tr('byMethod'),
      [
        { label: tr('method'), w: W - 160 },
        { label: tr('count'), w: 80, align: 'right' },
        { label: '%', w: 80, align: 'right' },
      ],
      methods.map(([k, v]) => [tr(`methods.${k}`), num(v), `${Math.round((v / Math.max(1, s.totals.guests)) * 100)}%`]),
    );

  // Footer on every page
  const generated = plain(new Intl.DateTimeFormat(intl(locale), { dateStyle: 'long', timeStyle: 'short', timeZone: TIME_ZONE }).format(ctx.generatedAt ?? new Date()));
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    const fy = PAGE_H - M + 10;
    doc.moveTo(M, fy - 8).lineTo(M + W, fy - 8).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(tr('generated', { date: generated }), M, fy, { width: W - 100, lineBreak: false });
    doc.text(tr('page', { page: i + 1, pages: range.count }), M + W - 100, fy, { width: 100, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}
