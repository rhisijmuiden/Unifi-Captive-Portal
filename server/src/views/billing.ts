import type { Invoice } from '../db/schema.js';
import { t, type Locale, type MessageKey, type Params } from '../i18n/index.js';
import { moneyLabel } from '../shared/guestStrings.js';
import { esc } from '../shared/portalDesign.js';

/**
 * The public page behind the pay link in invoice e-mails: a short summary, a pay button
 * and the PDF. Self-contained (no scripts), in the invoice's language.
 */

type PageOptions = { title: string; logo?: string | null; company: string; body: string; refresh?: { seconds: number; url: string } };

function layout(locale: Locale, o: PageOptions) {
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
${o.refresh ? `<meta http-equiv="refresh" content="${o.refresh.seconds};url=${esc(o.refresh.url)}">` : ''}
<title>${esc(o.title)}</title>
<style>
:root{--ink:#14213D;--muted:#4F5B73;--line:#DCE1EB;--bg:#F6F7FB;--card:#fff;--accent:#FF6B57;--ok:#1C8A57;--bad:#C23434}
@media (prefers-color-scheme:dark){:root{--ink:#EEF1F8;--muted:#A3ADC2;--line:#2A3550;--bg:#0E1628;--card:#152038}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 Archivo,"Segoe UI",system-ui,-apple-system,Arial,sans-serif}
main{max-width:520px;margin:0 auto;padding:40px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px;box-shadow:0 12px 40px -20px rgb(20 33 61/.35)}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:24px;min-height:36px}.brand img{max-height:40px;max-width:180px}.brand b{font-size:18px}
h1{font-size:24px;margin:0 0 6px;letter-spacing:-.01em}p{margin:0 0 16px;color:var(--muted)}
.rows{border-top:1px solid var(--line);margin:20px 0}.row{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--line);font-size:15px}.row span{color:var(--muted)}.row b{text-align:right}
.total{font-size:30px;font-weight:800;letter-spacing:-.02em;margin:4px 0 20px}
.btn{display:block;width:100%;text-align:center;border:0;border-radius:12px;padding:14px 18px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none;margin-top:10px}
.primary{background:var(--accent);color:#14213D}.secondary{background:transparent;color:var(--ink);border:1px solid var(--line)}
.note{border-radius:12px;padding:12px 14px;font-size:14px;margin:16px 0;background:var(--bg);color:var(--muted)}.note.ok{color:var(--ok)}.note.bad{color:var(--bad)}
.badge{display:inline-block;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700;background:var(--bg);color:var(--muted)}.badge.ok{color:var(--ok)}.badge.bad{color:var(--bad)}
footer{text-align:center;font-size:12px;color:var(--muted);margin-top:24px}footer a{color:var(--accent)}
</style>
</head>
<body><main>
<div class="card">
<div class="brand">${o.logo ? `<img src="${esc(o.logo)}" alt="${esc(o.company)}">` : `<b>${esc(o.company)}</b>`}</div>
${o.body}
</div>
<footer>Designed by <a href="https://rhis.nl" target="_blank" rel="noopener">RHIS</a></footer>
</main></body></html>`;
}

const day = (locale: Locale, iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
};

export function renderInvoicePage(locale: Locale, invoice: Invoice, o: { logo: string | null; canPay: boolean; overdue: boolean; base: string; error?: string }) {
  const tr = (key: string, params?: Params) => t(locale, `invoice.${key}` as MessageKey, params);
  const amount = moneyLabel(locale, invoice.totalCents, invoice.currency);
  const company = invoice.seller?.name ?? '';
  const status =
    invoice.status === 'paid'
      ? `<span class="badge ok">${esc(tr('statusPaid'))}</span>`
      : invoice.status === 'void'
        ? `<span class="badge bad">${esc(tr('void'))}</span>`
        : o.overdue
          ? `<span class="badge bad">${esc(tr('statusOverdue'))}</span>`
          : `<span class="badge">${esc(tr('statusOpen'))}</span>`;
  const rows: [string, string][] = [
    [tr('number'), invoice.number ?? ''],
    [tr('date'), invoice.issueDate ? day(locale, invoice.issueDate) : '—'],
    [tr('due'), invoice.dueDate ? day(locale, invoice.dueDate) : '—'],
  ];
  if (invoice.periodStart && invoice.periodEnd) rows.push([tr('period'), `${day(locale, invoice.periodStart)} – ${day(locale, invoice.periodEnd)}`]);
  const path = `${o.base}/billing/pay/${invoice.payToken}`;
  let action = '';
  if (invoice.status === 'paid') action = `<div class="note ok">${esc(tr('payPaid'))}</div>`;
  else if (invoice.status === 'void') action = `<div class="note bad">${esc(tr('payVoid'))}</div>`;
  else if (o.canPay) action = `<form method="post" action="${esc(path)}"><button class="btn primary" type="submit">${esc(tr('payButton', { amount }))}</button></form>`;
  else action = `<div class="note">${esc(tr('payUnavailable'))}</div>`;
  const body = `
<p style="margin-bottom:4px">${status}</p>
<h1>${esc(tr('payTitle', { number: invoice.number ?? '' }))}</h1>
<p>${esc(tr('payIntro', { company, customer: invoice.customer.name }))}</p>
<div class="total">${esc(amount)}</div>
${o.error ? `<div class="note bad">${esc(o.error)}</div>` : ''}
${action}
<a class="btn secondary" href="${esc(path)}/pdf">${esc(tr('payPdf'))}</a>
<div class="rows">${rows.map(([l, v]) => `<div class="row"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
  return layout(locale, { title: tr('payTitle', { number: invoice.number ?? '' }), logo: o.logo, company, body });
}

export function renderPayResult(locale: Locale, invoice: Invoice, o: { logo: string | null; state: 'paid' | 'pending' | 'failed'; base: string; self: string }) {
  const tr = (key: string) => t(locale, `invoice.${key}` as MessageKey);
  const path = `${o.base}/billing/pay/${invoice.payToken}`;
  const [title, text] =
    o.state === 'paid' ? [tr('payDoneTitle'), tr('payDoneBody')] : o.state === 'pending' ? [tr('payPendingTitle'), tr('payPendingBody')] : [tr('payFailedTitle'), tr('payFailedBody')];
  const button =
    o.state === 'failed'
      ? `<a class="btn primary" href="${esc(path)}">${esc(tr('payRetry'))}</a>`
      : `<a class="btn secondary" href="${esc(path)}">${esc(tr('payBack'))}</a>`;
  const body = `<h1>${esc(title)}</h1><p>${esc(text)}</p>${button}`;
  return layout(locale, { title, logo: o.logo, company: invoice.seller?.name ?? '', body, refresh: o.state === 'pending' ? { seconds: 3, url: o.self } : undefined });
}

export function renderPayNotFound(locale: Locale) {
  const text = t(locale, 'invoice.payNotFound');
  return layout(locale, { title: text, company: '', body: `<h1>${esc(text)}</h1>` });
}
