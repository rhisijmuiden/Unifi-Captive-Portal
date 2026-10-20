import { locales, t, type Locale } from '../i18n/index.js';

/**
 * Server-rendered guest pages. Guests have no internet yet, so everything is inline:
 * no external fonts, scripts or images, and the page works without JavaScript.
 */

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Plain text with blank-line paragraphs and line breaks, never HTML from the customer. */
const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');

const languageNames: Record<string, string> = { nl: 'Nederlands', en: 'English' };

type Shell = { locale: Locale; accent?: string; title: string; body: string; path: string; refresh?: { seconds: number; url: string } };

const ICON = `<svg viewBox="0 0 64 64" width="44" height="44" aria-hidden="true"><path d="M14 27a26 26 0 0 1 36 0M21 34a16 16 0 0 1 22 0M28 41a6 6 0 0 1 8 0" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="49" r="4" fill="currentColor"/></svg>`;

export function renderShell({ locale, accent = '#FF6B57', title, body, path, refresh }: Shell) {
  const langs = Object.keys(locales)
    .map((l) => (l === locale ? `<strong>${languageNames[l] ?? l}</strong>` : `<a href="${esc(path)}?lang=${l}" hreflang="${l}">${languageNames[l] ?? l}</a>`))
    .join('<span aria-hidden="true">·</span>');
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
${refresh ? `<meta http-equiv="refresh" content="${refresh.seconds};url=${esc(refresh.url)}">` : ''}
<title>${esc(title)}</title>
<style>
:root{--accent:${accent};--bg:#F6F7FB;--card:#fff;--text:#14213D;--muted:#5b6478;--line:#e3e6ef;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0b1222;--card:#14213D;--text:#F6F7FB;--muted:#a9b3c7;--line:#26365c}}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;background:var(--bg);color:var(--text);
  background-image:radial-gradient(60rem 30rem at 110% -10%,color-mix(in srgb,var(--accent) 22%,transparent),transparent),radial-gradient(40rem 25rem at -20% 110%,color-mix(in srgb,#9CC3FF 25%,transparent),transparent);
  display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px;min-height:100vh}
main{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:24px;padding:32px 28px;box-shadow:0 20px 50px -20px rgba(20,33,61,.35)}
.icon{width:72px;height:72px;border-radius:20px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent);margin-bottom:20px}
h1{font-size:1.6rem;line-height:1.2;margin:0 0 10px;letter-spacing:-.01em}
p{margin:0 0 12px;color:var(--muted);line-height:1.55}
form{margin-top:22px}
label.check{display:flex;gap:12px;align-items:flex-start;padding:14px;border:1px solid var(--line);border-radius:14px;cursor:pointer;line-height:1.4}
label.check input{width:20px;height:20px;margin:0;accent-color:var(--accent);flex:none}
details{margin-top:10px;border:1px solid var(--line);border-radius:14px;padding:10px 14px}
details summary{cursor:pointer;font-weight:600;font-size:.95rem}
details div{max-height:40vh;overflow:auto;margin-top:10px;font-size:.92rem}
.btn{display:block;width:100%;margin-top:18px;padding:15px 18px;border:0;border-radius:14px;background:var(--accent);color:#fff;font:inherit;font-weight:700;font-size:1.05rem;text-align:center;text-decoration:none;cursor:pointer}
.btn:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 45%,transparent);outline-offset:2px}
.note{font-size:.9rem;margin-top:14px}
.alert{background:color-mix(in srgb,#e5484d 12%,transparent);color:inherit;border-radius:12px;padding:10px 12px;font-size:.92rem}
nav{margin-top:22px;display:flex;gap:8px;justify-content:center;font-size:.85rem;color:var(--muted)}
nav a{color:inherit}
footer{margin-top:18px;font-size:.75rem;color:var(--muted)}
footer a{color:inherit;text-decoration:none}
</style>
</head>
<body>
<main>
<div class="icon">${ICON}</div>
${body}
<nav aria-label="${esc(t(locale, 'portal.language'))}">${langs}</nav>
</main>
<footer>Designed by <a href="https://rhis.nl" rel="noopener">RHIS</a></footer>
</body>
</html>`;
}

type MessageOptions = { extra?: string; accent?: string; path?: string; refresh?: Shell['refresh'] };

export function renderMessage(locale: Locale, title: string, text: string, { extra = '', accent, path = '', refresh }: MessageOptions = {}) {
  return renderShell({ locale, accent, title, path, refresh, body: `<h1>${esc(title)}</h1><p>${esc(text)}</p>${extra}` });
}

export function renderLogin(opts: {
  locale: Locale;
  accent: string;
  title: string;
  welcome: string;
  terms: string;
  requireTerms: boolean;
  action: string;
  path: string;
  error?: string;
}) {
  const { locale } = opts;
  const terms = opts.terms.trim();
  const body = `<h1>${esc(opts.title)}</h1>
${paragraphs(opts.welcome)}
<form method="post" action="${esc(opts.action)}">
${opts.error ? `<p class="alert" role="alert">${esc(opts.error)}</p>` : ''}
${opts.requireTerms ? `<label class="check"><input type="checkbox" name="terms" value="1" required> <span>${esc(t(locale, 'portal.acceptTerms'))}</span></label>` : ''}
${terms ? `<details><summary>${esc(t(locale, 'portal.showTerms'))}</summary><div>${paragraphs(terms)}</div></details>` : ''}
<input type="hidden" name="lang" value="${locale}">
<button class="btn" type="submit">${esc(t(locale, 'portal.connect'))}</button>
</form>`;
  return renderShell({ locale, accent: opts.accent, title: opts.title, body, path: opts.path });
}
