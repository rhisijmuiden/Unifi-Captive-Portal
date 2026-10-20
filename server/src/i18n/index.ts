import type { FastifyRequest } from 'fastify';
import en from './en.js';
import nl, { type Messages } from './nl.js';

/** Supported languages; keep in sync with web/src/i18n.ts. */
export const locales = { nl, en } satisfies Record<string, Messages>;
export type Locale = keyof typeof locales;
export const DEFAULT_LOCALE: Locale = 'en';

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;
export type Params = Record<string, string | number>;

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && v in locales;

export function normalizeLocale(v: string | null | undefined): Locale | null {
  const code = v?.toLowerCase().split(/[-_]/)[0];
  return isLocale(code) ? code : null;
}

export function t(locale: Locale, key: MessageKey, params?: Params): string {
  const lookup = (msgs: Messages) => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], msgs);
  const text = (lookup(locales[locale]) ?? lookup(locales[DEFAULT_LOCALE]) ?? key) as string;
  return params ? text.replace(/\{\{(\w+)\}\}/g, (_, p: string) => String(params[p] ?? '')) : text;
}

/** Interface language first (x-locale header), then the user's saved language, then the browser's. */
export function requestLocale(req: FastifyRequest): Locale {
  const header = req.headers['x-locale'];
  const fromBrowser = String(req.headers['accept-language'] ?? '')
    .split(',')
    .map((part) => normalizeLocale(part.split(';')[0].trim()))
    .find(Boolean);
  return normalizeLocale(typeof header === 'string' ? header : null) ?? normalizeLocale(req.user?.locale) ?? fromBrowser ?? DEFAULT_LOCALE;
}
