import { guestStrings, type GuestLocale } from '../shared/guestStrings.js';
import { esc, renderPortalDocument, type LoginContext, type PortalDesign, type RenderContext } from '../shared/portalDesign.js';
import { defaultDesign } from '../shared/portalTemplates.js';

/**
 * Server-rendered guest pages, built from the customer's design (see shared/portalDesign.ts).
 * Guests have no internet yet, so everything is inline and works without JavaScript.
 */

export { esc };

type Page = {
  locale: GuestLocale;
  design?: PortalDesign;
  /** Languages the portal offers; the first one is the fallback for missing texts. */
  languages?: string[];
  path: string;
  /** The customer's privacy page, linked in the footer. */
  privacyHref?: string;
  designedBy?: boolean;
};

const context = (page: Page, login?: LoginContext): RenderContext => {
  const languages = page.languages?.length ? page.languages : Object.keys(guestStrings);
  return {
    locale: page.locale,
    fallbackLocale: languages[0],
    languages: languages.map((code) => ({ code, href: `${page.path}?lang=${code}` })),
    privacyHref: page.privacyHref,
    designedBy: page.designedBy,
    login: login ?? { methods: [], requireTerms: false, terms: '', emailFields: { name: 'off', phone: 'off', marketing: false }, paymentEmail: 'off', packages: [], action: '' },
  };
};

export function renderGuestPage(page: Page & { title: string; login: LoginContext }) {
  return renderPortalDocument(page.design ?? defaultDesign(), context(page, page.login), { title: page.title });
}

type MessageOptions = { extra?: string; design?: PortalDesign; languages?: string[]; path?: string; refresh?: { seconds: number; url: string }; privacyHref?: string; designedBy?: boolean };

/**
 * Label/value pairs, each label above its value so long labels and values fit a phone screen.
 * Empty values are left out.
 */
export function renderDetails(rows: [string, string | null | undefined][]) {
  const items = rows
    .filter(([, value]) => value)
    .map(
      ([label, value]) =>
        `<div style="padding:10px 0;border-top:1px solid var(--line)"><dt style="font-size:.8rem;color:var(--muted)">${esc(label)}</dt><dd style="margin:2px 0 0;color:var(--text);white-space:pre-line;overflow-wrap:anywhere">${esc(value!)}</dd></div>`,
    )
    .join('');
  return `<dl style="margin:14px 0;text-align:left;font-size:.95rem">${items}</dl>`;
}

export function renderMessage(locale: GuestLocale, title: string, text: string, opts: MessageOptions = {}) {
  const page = { locale, design: opts.design, languages: opts.languages, path: opts.path ?? '', privacyHref: opts.privacyHref, designedBy: opts.designedBy };
  return renderPortalDocument(opts.design ?? defaultDesign(), context(page), { title, message: { title, text, extra: opts.extra }, refresh: opts.refresh });
}
