import { durationLabel, fill, guestStrings, languageNames, type GuestLocale, type GuestStrings } from './guestStrings.js';

/**
 * The guest portal design: a theme plus an ordered list of blocks, built in the
 * drag-and-drop editor. This module renders it to HTML and is shared by the server
 * (real guest pages) and the editor (live preview), so what you see is what guests get.
 *
 * Guests have no internet yet: no external fonts, scripts or images, and every page
 * works without JavaScript. Images are served by this server (/portal/media/<id>).
 */

export type Texts = Record<string, string>;

export type PortalTheme = {
  accent: string;
  buttonText: string;
  background: string;
  background2: string;
  backgroundStyle: 'solid' | 'gradient' | 'image';
  backgroundImage: string | null;
  card: string;
  text: string;
  muted: string;
  font: 'system' | 'rounded' | 'humanist' | 'serif';
  radius: number;
  layout: 'card' | 'plain';
  align: 'left' | 'center';
};

export type PortalBlock =
  | { id: string; type: 'logo'; src: string | null; height: number }
  | { id: string; type: 'icon' }
  | { id: string; type: 'heading'; text: Texts; size: 'md' | 'lg' | 'xl' }
  | { id: string; type: 'text'; text: Texts; size: 'sm' | 'md' }
  | { id: string; type: 'image'; src: string | null; alt: Texts }
  | { id: string; type: 'button'; label: Texts; url: string }
  | { id: string; type: 'divider' }
  | { id: string; type: 'spacer'; size: number }
  | { id: string; type: 'login' };

export type BlockType = PortalBlock['type'];
/** A block without its id (distributes over the union). */
export type NoId<T> = T extends unknown ? Omit<T, 'id'> : never;
export type PortalDesign = { version: 1; theme: PortalTheme; blocks: PortalBlock[] };

export type LoginMethod = 'free' | 'email' | 'sms' | 'voucher' | 'room' | 'payment' | 'facebook' | 'google' | 'apple' | 'microsoft';
export const loginMethods: LoginMethod[] = ['free', 'email', 'sms', 'voucher', 'room', 'payment', 'facebook', 'google', 'apple', 'microsoft'];
/** Sign-in with an account elsewhere; on the guest page these share one tab with a button each. */
export type SocialMethod = 'facebook' | 'google' | 'apple' | 'microsoft';
export const socialMethods: SocialMethod[] = ['google', 'apple', 'microsoft', 'facebook'];
export const isSocial = (m: string): m is SocialMethod => (socialMethods as string[]).includes(m);
/** A tab on the guest page: one login method, or all social sign-ins together. */
type LoginTab = Exclude<LoginMethod, SocialMethod> | 'social';
const tabOf = (m: LoginMethod): LoginTab => (isSocial(m) ? 'social' : m);
const loginTabs: LoginTab[] = ['free', 'email', 'sms', 'voucher', 'room', 'payment', 'social'];
export type FieldMode = 'off' | 'optional' | 'required';

export type LoginContext = {
  methods: LoginMethod[];
  requireTerms: boolean;
  terms: string;
  emailFields: { name: FieldMode; phone: FieldMode; marketing: boolean };
  paymentEmail: FieldMode;
  packages: { id: string; name: string; price: string; minutes: number }[];
  action: string;
  active?: LoginMethod;
  error?: string;
  values?: Partial<Record<'name' | 'email' | 'phone' | 'code' | 'package' | 'room' | 'surname', string>>;
  /** SMS: a code was sent to this (masked) number; the form now asks for the code. */
  smsSent?: { masked: string; canResend: boolean };
  /** SMS: the country code assumed for numbers without one, shown as a hint. */
  smsCountry?: string;
};

export type RenderContext = {
  locale: GuestLocale;
  /** Language the texts fall back to when a text is missing in the guest's language. */
  fallbackLocale: string;
  login: LoginContext;
  /** Links to the same page in the portal's other languages. */
  languages: { code: string; href: string }[];
  /** The customer's privacy page (erase requests), linked in the footer. */
  privacyHref?: string;
};

export const MEDIA_PATH = /^\/portal\/media\/[0-9a-f-]{36}$/;

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Plain text with blank-line paragraphs and line breaks, never HTML from the customer. */
export const paragraphs = (text: string, cls = '') =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p${cls ? ` class="${cls}"` : ''}>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

export const pickText = (texts: Texts | undefined, locale: string, fallback: string) =>
  (texts && (texts[locale] || texts[fallback] || Object.values(texts).find(Boolean))) || '';

const safeImage = (src: string | null) => (src && MEDIA_PATH.test(src) ? src : null);
const safeLink = (u: string) => (/^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null);
const color = (v: string, fallback: string) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback);

const fonts: Record<PortalTheme['font'], string> = {
  system: 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
  rounded: 'ui-rounded,"SF Pro Rounded","Hiragino Maru Gothic ProN",Quicksand,Comfortaa,Manjari,"Arial Rounded MT","Arial Rounded MT Bold",Calibri,source-sans-pro,sans-serif',
  humanist: 'Seravek,"Gill Sans Nova",Ubuntu,Calibri,"DejaVu Sans",source-sans-pro,sans-serif',
  serif: '"Iowan Old Style","Palatino Linotype","URW Palladio L",P052,Georgia,serif',
};

export const defaultTheme: PortalTheme = {
  accent: '#FF6B57',
  buttonText: '#FFFFFF',
  background: '#F6F7FB',
  background2: '#9CC3FF',
  backgroundStyle: 'gradient',
  backgroundImage: null,
  card: '#FFFFFF',
  text: '#14213D',
  muted: '#5B6478',
  font: 'system',
  radius: 20,
  layout: 'card',
  align: 'left',
};

/** CSS variables for a theme. */
export function themeVars(theme: PortalTheme): Record<string, string> {
  const th = { ...defaultTheme, ...theme };
  const bg = color(th.background, defaultTheme.background);
  const accent = color(th.accent, defaultTheme.accent);
  const image = safeImage(th.backgroundImage);
  const backdrop =
    th.backgroundStyle === 'image' && image
      ? `linear-gradient(color-mix(in srgb,${bg} 35%,transparent),color-mix(in srgb,${bg} 35%,transparent)),url(${image}) center/cover no-repeat ${bg}`
      : th.backgroundStyle === 'gradient'
        ? `radial-gradient(60rem 30rem at 110% -10%,color-mix(in srgb,${accent} 24%,transparent),transparent),radial-gradient(40rem 25rem at -20% 110%,color-mix(in srgb,${color(th.background2, defaultTheme.background2)} 30%,transparent),transparent) ${bg}`
        : bg;
  return {
    '--accent': accent,
    '--btn-text': color(th.buttonText, '#FFFFFF'),
    '--bg': bg,
    '--backdrop': backdrop,
    '--card': color(th.card, '#FFFFFF'),
    '--text': color(th.text, '#14213D'),
    '--muted': color(th.muted, '#5B6478'),
    '--radius': `${Math.max(0, Math.min(32, Number(th.radius) || 0))}px`,
    '--font': fonts[th.font] ?? fonts.system,
    '--align': th.align === 'center' ? 'center' : 'left',
  };
}

/** The theme as an inline style attribute value (escape it before use). */
export const themeStyle = (theme: PortalTheme) =>
  Object.entries(themeVars(theme))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');

/** All portal CSS, scoped to .cp-page so the editor can show it inside the admin interface. */
export const portalCss = `
.cp-page{--line:color-mix(in srgb,var(--text) 14%,transparent);box-sizing:border-box;min-height:var(--cp-min-h,100vh);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px;background:var(--backdrop);color:var(--text);font-family:var(--font);font-size:16px;line-height:1.5;text-align:var(--align)}
.cp-page *,.cp-page *::before,.cp-page *::after{box-sizing:border-box}
.cp-page .cp-main{width:100%;max-width:440px;padding:32px 28px;border-radius:calc(var(--radius) + 4px)}
.cp-page.cp-card .cp-main{background:var(--card);border:1px solid var(--line);box-shadow:0 20px 50px -20px rgba(20,33,61,.35)}
.cp-page.cp-plain .cp-main{max-width:480px;padding:12px 4px}
.cp-page .cp-block+.cp-block{margin-top:14px}
.cp-page h1,.cp-page h2{margin:0;color:var(--text);letter-spacing:-.01em;line-height:1.2;font-weight:700}
.cp-page .cp-h-md{font-size:1.3rem}.cp-page .cp-h-lg{font-size:1.6rem}.cp-page .cp-h-xl{font-size:2.1rem}
.cp-page p{margin:0 0 10px;color:var(--muted)}
.cp-page p:last-child{margin-bottom:0}
.cp-page .cp-t-sm p{font-size:.85rem}
.cp-page .cp-logo{display:flex;justify-content:var(--align)}
.cp-page .cp-logo img{display:block;max-width:100%;width:auto;object-fit:contain}
.cp-page .cp-icon{width:72px;height:72px;border-radius:var(--radius);display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}
.cp-page.cp-center .cp-icon{margin:0 auto}
.cp-page .cp-image img{display:block;width:100%;height:auto;border-radius:var(--radius)}
.cp-page .cp-divider{border:0;border-top:1px solid var(--line);margin:18px 0}
.cp-page .cp-placeholder{display:grid;place-items:center;border:2px dashed var(--line);border-radius:var(--radius);color:var(--muted);font-size:.85rem;padding:18px}
.cp-page .cp-btn{display:block;width:100%;margin-top:16px;padding:14px 18px;border:0;border-radius:var(--radius);background:var(--accent);color:var(--btn-text);font:inherit;font-weight:700;font-size:1.02rem;text-align:center;text-decoration:none;cursor:pointer;line-height:1.3}
.cp-page .cp-btn:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 45%,transparent);outline-offset:2px}
.cp-page .cp-btn-fb,.cp-page .cp-btn-social{display:flex;align-items:center;justify-content:center;gap:10px;background:#1877F2;color:#fff}
.cp-page .cp-btn-social+.cp-btn-social{margin-top:10px}
.cp-page .cp-btn-google,.cp-page .cp-btn-microsoft{background:#fff;color:#1f1f1f;border:1px solid #dadce0}
.cp-page .cp-btn-apple{background:#000;color:#fff}
.cp-page .cp-link{display:inline-block;margin-top:12px;padding:0;border:0;background:none;color:var(--accent);font:inherit;font-size:.9rem;font-weight:600;cursor:pointer;text-decoration:underline}
.cp-page .cp-sent{font-size:.92rem;margin-bottom:12px}
.cp-page .cp-ad{position:relative;margin:4px 0 8px}
.cp-page .cp-ad img,.cp-page .cp-ad video{display:block;width:100%;height:auto;max-height:60vh;object-fit:contain;border-radius:var(--radius);background:#000}
.cp-page .cp-ad img{background:transparent}
.cp-page .cp-ad small{display:block;margin-top:6px;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.cp-page .cp-gate{display:grid}
.cp-page .cp-gate>*{grid-area:1/1}
.cp-page .cp-gate .cp-wait{margin-top:16px;padding:14px;text-align:center;font-size:.92rem;color:var(--muted);animation:cp-out 0s linear var(--wait,5s) forwards}
.cp-page .cp-gate .cp-btn{visibility:hidden;animation:cp-in 0s linear var(--wait,5s) forwards}
@keyframes cp-in{to{visibility:visible}}
@keyframes cp-out{to{visibility:hidden}}
.cp-page .cp-stars{display:flex;flex-direction:row-reverse;justify-content:flex-end;gap:4px;margin:6px 0 12px}
.cp-page.cp-center .cp-stars{justify-content:center}
.cp-page .cp-stars input{position:absolute;opacity:0;pointer-events:none}
.cp-page .cp-stars label{font-size:2.2rem;line-height:1;color:color-mix(in srgb,var(--text) 18%,transparent);cursor:pointer}
.cp-page .cp-stars input:checked~label,.cp-page .cp-stars label:hover,.cp-page .cp-stars label:hover~label{color:#F5B301}
.cp-page .cp-stars input:focus-visible+label{outline:3px solid color-mix(in srgb,var(--accent) 45%,transparent);border-radius:6px}
.cp-page textarea.cp-input{min-height:84px;resize:vertical}
.cp-page .cp-btn-review{display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#1f1f1f;border:1px solid #dadce0}
.cp-page .cp-btn-outline{background:transparent;color:var(--accent);border:2px solid var(--accent);margin-top:0}
.cp-page .cp-tab-r{position:absolute;opacity:0;pointer-events:none}
.cp-page .cp-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:4px;border-radius:calc(var(--radius) * .7 + 4px);background:color-mix(in srgb,var(--text) 6%,transparent);margin-bottom:16px}
.cp-page .cp-tabs label{flex:1 1 auto;text-align:center;padding:8px 6px;border-radius:calc(var(--radius) * .7);font-size:.9rem;font-weight:600;color:var(--muted);cursor:pointer}
.cp-page .cp-panel{display:none;text-align:left}
.cp-page .cp-solo{display:block}
${loginTabs.map((m) => `.cp-page #cp-m-${m}:checked~.cp-p-${m}`).join(',')}{display:block}
${loginTabs.map((m) => `.cp-page #cp-m-${m}:checked~.cp-tabs [for=cp-m-${m}]`).join(',')}{background:var(--card);color:var(--text);box-shadow:0 1px 3px rgba(20,33,61,.18)}
.cp-page .cp-field{display:block;margin-bottom:12px}
.cp-page .cp-field span{display:block;font-size:.85rem;font-weight:600;margin-bottom:6px;color:var(--text)}
.cp-page .cp-field small{font-weight:400;color:var(--muted)}
.cp-page .cp-input{display:block;width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:calc(var(--radius) * .7);background:var(--card);color:var(--text);font:inherit;font-size:1rem}
.cp-page .cp-input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 18%,transparent)}
.cp-page .cp-code{text-transform:uppercase;letter-spacing:.12em;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.cp-page .cp-check{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border:1px solid var(--line);border-radius:calc(var(--radius) * .7);cursor:pointer;line-height:1.4;font-size:.92rem;margin-top:10px;color:var(--text)}
.cp-page .cp-check input{width:20px;height:20px;margin:0;accent-color:var(--accent);flex:none}
.cp-page .cp-pkgs{display:grid;gap:8px;margin-bottom:12px}
.cp-page .cp-pkg{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--line);border-radius:calc(var(--radius) * .7);cursor:pointer}
.cp-page .cp-pkg input{width:18px;height:18px;margin:0;accent-color:var(--accent);flex:none}
.cp-page .cp-pkg b{display:block;color:var(--text)}
.cp-page .cp-pkg small{color:var(--muted)}
.cp-page .cp-pkg em{margin-left:auto;font-style:normal;font-weight:700;color:var(--text)}
.cp-page .cp-pkg:has(input:checked){border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent)}
.cp-page details{margin-top:12px;border:1px solid var(--line);border-radius:calc(var(--radius) * .7);padding:10px 14px;text-align:left}
.cp-page details summary{cursor:pointer;font-weight:600;font-size:.92rem}
.cp-page details div{max-height:40vh;overflow:auto;margin-top:10px;font-size:.9rem}
.cp-page .cp-note{font-size:.9rem;margin-top:14px}
.cp-page .cp-alert{background:color-mix(in srgb,#e5484d 13%,transparent);color:var(--text);border-radius:calc(var(--radius) * .6);padding:10px 12px;font-size:.92rem;margin-bottom:12px}
.cp-page .cp-langs{margin-top:22px;display:flex;gap:8px;justify-content:center;font-size:.85rem;color:var(--muted)}
.cp-page .cp-langs a{color:inherit}
.cp-page .cp-foot{margin-top:18px;font-size:.75rem;color:var(--muted)}
.cp-page .cp-foot a{color:inherit;text-decoration:none}
`;

const WIFI = `<svg viewBox="0 0 64 64" width="44" height="44" aria-hidden="true"><path d="M14 27a26 26 0 0 1 36 0M21 34a16 16 0 0 1 22 0M28 41a6 6 0 0 1 8 0" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="49" r="4" fill="currentColor"/></svg>`;

const FB = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4h-3V12h3V9.4c0-3 1.8-4.7 4.6-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z"/></svg>`;

const GOOGLE = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>`;

const APPLE = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M16.4 12.7c0-2.6 2.1-3.8 2.2-3.9a4.8 4.8 0 0 0-3.8-2c-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9a5 5 0 0 0-4.2 2.6c-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.6-1-2.6-4.1zM13.9 5.1c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3-1.5z"/></svg>`;

const MICROSOFT = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#F25022" d="M1 1h10.5v10.5H1z"/><path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z"/><path fill="#00A4EF" d="M1 12.5h10.5V23H1z"/><path fill="#FFB900" d="M12.5 12.5H23V23H12.5z"/></svg>`;

const socialIcons: Record<SocialMethod, string> = { facebook: FB, google: GOOGLE, apple: APPLE, microsoft: MICROSOFT };

const methodLabel = (s: GuestStrings, m: LoginMethod) =>
  ({
    free: s.methodFree,
    email: s.methodEmail,
    sms: s.methodSms,
    voucher: s.methodVoucher,
    room: s.methodRoom,
    payment: s.methodPayment,
    facebook: s.methodFacebook,
    google: s.methodGoogle,
    apple: s.methodApple,
    microsoft: s.methodMicrosoft,
  })[m];

const continueWith = (s: GuestStrings, m: SocialMethod) =>
  ({ facebook: s.continueFacebook, google: s.continueGoogle, apple: s.continueApple, microsoft: s.continueMicrosoft })[m];

function termsCheck(s: GuestStrings, login: LoginContext) {
  return login.requireTerms
    ? `<label class="cp-check"><input type="checkbox" name="terms" value="1" required> <span>${esc(s.acceptTerms)}</span></label>`
    : '';
}

function field(label: string, mode: FieldMode, input: string, s: GuestStrings) {
  if (mode === 'off') return '';
  return `<label class="cp-field"><span>${esc(label)}${mode === 'optional' ? ` <small>(${esc(s.optional)})</small>` : ''}</span>${input}</label>`;
}

function input(name: string, type: string, mode: FieldMode, value = '', extra = '') {
  return `<input class="cp-input" type="${type}" name="${name}" value="${esc(value)}"${mode === 'required' ? ' required' : ''}${extra}>`;
}

const errorFor = (login: LoginContext, tab: LoginTab) =>
  login.error && login.active && tabOf(login.active) === tab ? `<p class="cp-alert" role="alert">${esc(login.error)}</p>` : '';

/** All social sign-ins in one form; the button pressed tells which one. */
function socialForm(methods: SocialMethod[], ctx: RenderContext, cls: string) {
  const s = guestStrings[ctx.locale];
  const { login } = ctx;
  const buttons = methods
    .map((m) => `<button class="cp-btn cp-btn-social cp-btn-${m}" type="submit" name="method" value="${m}">${socialIcons[m]}<span>${esc(continueWith(s, m))}</span></button>`)
    .join('');
  const marketing = login.emailFields.marketing ? `<label class="cp-check"><input type="checkbox" name="marketing" value="1"> <span>${esc(s.marketing)}</span></label>` : '';
  return `<form class="cp-panel ${cls}" method="post" action="${esc(login.action)}">${errorFor(login, 'social')}<input type="hidden" name="lang" value="${ctx.locale}">${termsCheck(s, login)}${marketing}${buttons}</form>`;
}

function methodForm(m: Exclude<LoginMethod, SocialMethod>, ctx: RenderContext, cls: string) {
  const s = guestStrings[ctx.locale];
  const { login } = ctx;
  const v = login.active === m ? (login.values ?? {}) : {};
  const error = errorFor(login, m);
  const open = (extra = '') => `<form class="cp-panel ${cls}" method="post" action="${esc(login.action)}">${error}<input type="hidden" name="method" value="${m}"><input type="hidden" name="lang" value="${ctx.locale}">${extra}`;
  let fields = '';
  let button = s.connect;
  if (m === 'email') {
    const f = login.emailFields;
    fields =
      field(s.name, f.name, input('name', 'text', f.name, v.name, ' autocomplete="name" maxlength="120"'), s) +
      field(s.email, 'required', input('email', 'email', 'required', v.email, ' autocomplete="email" maxlength="254"'), s) +
      field(s.phone, f.phone, input('phone', 'tel', f.phone, v.phone, ' autocomplete="tel" maxlength="40"'), s) +
      (f.marketing ? `<label class="cp-check"><input type="checkbox" name="marketing" value="1"> <span>${esc(s.marketing)}</span></label>` : '');
    button = s.register;
  } else if (m === 'sms') {
    const sent = login.active === 'sms' ? login.smsSent : undefined;
    if (sent) {
      // Step two: the code. The phone number travels along so a resend needs no typing.
      const code = `<label class="cp-field"><span>${esc(s.smsCode)}</span><input class="cp-input cp-code" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" required autofocus></label>`;
      const resend = sent.canResend ? `<button class="cp-link" type="submit" name="resend" value="1" formnovalidate>${esc(s.smsResend)}</button>` : '';
      return `${open(`<input type="hidden" name="phone" value="${esc(v.phone ?? '')}"><p class="cp-sent">${esc(fill(s.smsSent, { phone: sent.masked }))}</p>`)}${code}<button class="cp-btn" type="submit">${esc(s.smsVerify)}</button>${resend}</form>`;
    }
    const hint = login.smsCountry ? ` placeholder="${esc(fill(s.smsPlaceholder, { cc: login.smsCountry }))}"` : '';
    fields = field(s.phone, 'required', input('phone', 'tel', 'required', v.phone, ` autocomplete="tel" inputmode="tel" maxlength="24"${hint}`), s);
    button = s.smsSend;
  } else if (m === 'voucher') {
    fields = field(
      s.voucherCode,
      'required',
      `<input class="cp-input cp-code" type="text" name="code" value="${esc(v.code ?? '')}" placeholder="${esc(s.voucherPlaceholder)}" required autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="32">`,
      s,
    );
    button = s.redeem;
  } else if (m === 'room') {
    fields =
      field(s.roomNumber, 'required', input('room', 'text', 'required', v.room, ' autocomplete="off" maxlength="20" autocapitalize="characters"'), s) +
      field(s.surname, 'required', input('surname', 'text', 'required', v.surname, ' autocomplete="family-name" maxlength="80"'), s);
  } else if (m === 'payment') {
    const chosen = v.package ?? login.packages[0]?.id;
    const pkgs = login.packages
      .map(
        (p) =>
          `<label class="cp-pkg"><input type="radio" name="package" value="${esc(p.id)}"${p.id === chosen ? ' checked' : ''} required><span><b>${esc(p.name)}</b><small>${esc(durationLabel(s, p.minutes))}</small></span><em>${esc(p.price)}</em></label>`,
      )
      .join('');
    fields =
      `<p class="cp-field"><span>${esc(s.choosePackage)}</span></p><div class="cp-pkgs">${pkgs}</div>` +
      field(s.emailForReceipt, login.paymentEmail, input('email', 'email', login.paymentEmail, v.email, ' autocomplete="email" maxlength="254"'), s);
    button = s.pay;
  }
  return `${open()}${fields}${termsCheck(s, login)}<button class="cp-btn" type="submit">${esc(button)}</button></form>`;
}

export function renderLoginBlock(ctx: RenderContext) {
  const s = guestStrings[ctx.locale];
  const { login } = ctx;
  const methods = login.methods.filter((m) => m !== 'payment' || login.packages.length);
  const terms = login.terms.trim()
    ? `<details><summary>${esc(s.showTerms)}</summary><div>${paragraphs(login.terms)}</div></details>`
    : '';
  if (!methods.length) return `<p class="cp-alert">${esc(s.noMethods)}</p>`;
  const social = socialMethods.filter((m) => methods.includes(m));
  const tabs = loginTabs.filter((tab) => (tab === 'social' ? social.length > 0 : methods.includes(tab)));
  const panel = (tab: LoginTab, cls: string) => (tab === 'social' ? socialForm(social, ctx, cls) : methodForm(tab, ctx, cls));
  if (tabs.length === 1) return panel(tabs[0], 'cp-solo') + terms;
  const wanted = login.active ? tabOf(login.active) : null;
  const active = wanted && tabs.includes(wanted) ? wanted : tabs[0];
  // One social method keeps its own name on the tab ("Facebook"); several share "Account"
  const tabLabel = (tab: LoginTab) => (tab === 'social' ? (social.length === 1 ? methodLabel(s, social[0]) : s.methodSocial) : methodLabel(s, tab));
  const radios = tabs.map((m) => `<input class="cp-tab-r" type="radio" name="cp-method" id="cp-m-${m}"${m === active ? ' checked' : ''}>`).join('');
  const tabList = `<div class="cp-tabs" role="tablist" aria-label="${esc(s.chooseMethod)}">${tabs.map((m) => `<label for="cp-m-${m}">${esc(tabLabel(m))}</label>`).join('')}</div>`;
  return `<div>${radios}${tabList}${tabs.map((m) => panel(m, `cp-p-${m}`)).join('')}</div>${terms}`;
}

/** One block as HTML. `placeholders` shows empty images in the editor instead of hiding them. */
export function renderBlock(block: PortalBlock, ctx: RenderContext, placeholders = false): string {
  const s = guestStrings[ctx.locale];
  const text = (texts: Texts) => pickText(texts, ctx.locale, ctx.fallbackLocale);
  switch (block.type) {
    case 'logo': {
      const src = safeImage(block.src);
      const h = Math.max(24, Math.min(160, Number(block.height) || 56));
      if (!src) return placeholders ? `<div class="cp-placeholder" style="height:${h}px">Logo</div>` : '';
      return `<div class="cp-logo"><img src="${src}" alt="" style="height:${h}px"></div>`;
    }
    case 'icon':
      return `<div class="cp-icon">${WIFI}</div>`;
    case 'heading':
      return `<h1 class="cp-h-${block.size}">${esc(text(block.text) || s.defaultTitle)}</h1>`;
    case 'text': {
      const body = text(block.text);
      return body ? `<div class="cp-t-${block.size}">${paragraphs(body)}</div>` : placeholders ? '<div class="cp-placeholder">…</div>' : '';
    }
    case 'image': {
      const src = safeImage(block.src);
      if (!src) return placeholders ? '<div class="cp-placeholder" style="height:120px">Image</div>' : '';
      return `<div class="cp-image"><img src="${src}" alt="${esc(text(block.alt))}"></div>`;
    }
    case 'button': {
      const href = safeLink(block.url);
      const label = text(block.label);
      if (!label || (!href && !placeholders)) return '';
      return `<a class="cp-btn cp-btn-outline" href="${esc(href ?? '#')}" rel="noopener">${esc(label)}</a>`;
    }
    case 'divider':
      return '<hr class="cp-divider">';
    case 'spacer':
      return `<div style="height:${Math.max(4, Math.min(120, Number(block.size) || 16))}px"></div>`;
    case 'login':
      return renderLoginBlock(ctx);
  }
}

/** Classes on the .cp-page element for a theme. */
export const pageClass = (theme: PortalTheme) => `${theme.layout === 'plain' ? 'cp-plain' : 'cp-card'}${theme.align === 'center' ? ' cp-center' : ''}`;

const wrap = (html: string) => (html ? `<div class="cp-block">${html}</div>` : '');

function languageNav(ctx: RenderContext) {
  if (ctx.languages.length < 2) return '';
  const s = guestStrings[ctx.locale];
  const links = ctx.languages
    .map((l) => (l.code === ctx.locale ? `<strong>${languageNames[l.code] ?? l.code}</strong>` : `<a href="${esc(l.href)}" hreflang="${l.code}">${languageNames[l.code] ?? l.code}</a>`))
    .join('<span aria-hidden="true">·</span>');
  return `<nav class="cp-langs" aria-label="${esc(s.language)}">${links}</nav>`;
}

/** The page body: design blocks, or (for messages) the logo plus a title, text and extra HTML. */
export function renderPortalBody(design: PortalDesign, ctx: RenderContext, message?: { title: string; text: string; extra?: string }) {
  const blocks = message
    ? [
        ...design.blocks.filter((b) => b.type === 'logo').map((b) => wrap(renderBlock(b, ctx))),
        message.title ? wrap(`<h1 class="cp-h-lg">${esc(message.title)}</h1>`) : '',
        wrap(`${message.text ? `<p>${esc(message.text)}</p>` : ''}${message.extra ?? ''}`),
      ]
    : design.blocks.map((b) => wrap(renderBlock(b, ctx)));
  const layout = pageClass(design.theme);
  return `<div class="cp-page ${layout}" style="${esc(themeStyle(design.theme))}"><main class="cp-main">${blocks.join('')}${languageNav(ctx)}</main><footer class="cp-foot">${ctx.privacyHref ? `<a href="${esc(ctx.privacyHref)}">${esc(guestStrings[ctx.locale].privacy)}</a> · ` : ''}Designed by <a href="https://rhis.nl" rel="noopener">RHIS</a></footer></div>`;
}

export function renderPortalDocument(
  design: PortalDesign,
  ctx: RenderContext,
  opts: { title: string; message?: { title: string; text: string; extra?: string }; refresh?: { seconds: number; url: string } },
) {
  return `<!doctype html>
<html lang="${ctx.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
${opts.refresh ? `<meta http-equiv="refresh" content="${opts.refresh.seconds};url=${esc(opts.refresh.url)}">` : ''}
<title>${esc(opts.title)}</title>
<style>html,body{margin:0;min-height:100%}body{background:${color(design.theme.background, defaultTheme.background)}}${portalCss}</style>
</head>
<body>
${renderPortalBody(design, ctx, opts.message)}
</body>
</html>`;
}

export const fillText = fill;

let counter = 0;
export const newBlockId = () => `b${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A new block of a type with sensible defaults, as added from the editor's palette. */
export function createBlock(type: BlockType): PortalBlock {
  const id = newBlockId();
  switch (type) {
    case 'logo':
      return { id, type, src: null, height: 56 };
    case 'heading':
      return { id, type, text: {}, size: 'lg' };
    case 'text':
      return { id, type, text: {}, size: 'md' };
    case 'image':
      return { id, type, src: null, alt: {} };
    case 'button':
      return { id, type, label: {}, url: 'https://' };
    case 'spacer':
      return { id, type, size: 24 };
    default:
      return { id, type } as PortalBlock;
  }
}
