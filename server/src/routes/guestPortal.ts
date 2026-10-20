import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, schema } from '../db/index.js';
import { DEFAULT_LOCALE, normalizeLocale, t, type Locale } from '../i18n/index.js';
import { authorizeSession, createGuestSession, getPortalSettings, isExpired, resolveSite } from '../services/guests.js';
import { hostnameTenant, tenantPortalOrigin } from '../services/hostnames.js';
import { esc, renderLogin, renderMessage } from '../views/portal.js';

type GuestQuery = { id?: string; ap?: string; ssid?: string; url?: string; t?: string; lang?: string };

const MAC_RE = /^([0-9a-f]{2}[:-]?){5}[0-9a-f]{2}$/i;
const safeUrl = (u: string | null | undefined) => (u && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null);
const pick = (texts: Record<string, string>, locale: Locale) => texts[locale] || texts[DEFAULT_LOCALE] || Object.values(texts).find(Boolean) || '';

/** Guest language: explicit ?lang= choice, then the browser's languages. */
function guestLocale(req: FastifyRequest, chosen?: string | null): Locale {
  const fromBrowser = String(req.headers['accept-language'] ?? '')
    .split(',')
    .map((part) => normalizeLocale(part.split(';')[0].trim()))
    .find(Boolean);
  return normalizeLocale(chosen) ?? fromBrowser ?? DEFAULT_LOCALE;
}

function html(reply: FastifyReply, body: string, status = 200) {
  return reply
    .code(status)
    .header('cache-control', 'no-store')
    .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
    .type('text/html; charset=utf-8')
    .send(body);
}

export async function guestPortalRoutes(app: FastifyInstance) {
  /**
   * UniFi sends a guest here when "External portal server" points at this server:
   * http://<server>/guest/s/<site>/?ap=<ap mac>&id=<client mac>&t=<time>&url=<page>&ssid=<ssid>
   */
  const receive = async (req: FastifyRequest<{ Params: { site: string }; Querystring: GuestQuery }>, reply: FastifyReply) => {
    const q = req.query;
    const locale = guestLocale(req, q.lang);
    if (!q.id || !MAC_RE.test(q.id)) {
      return html(reply, renderMessage(locale, t(locale, 'portal.expiredTitle'), t(locale, 'portal.expiredBody')), 400);
    }
    const ap = q.ap && MAC_RE.test(q.ap) ? q.ap : null;
    const site = await resolveSite(req.params.site, ap);
    if (!site) {
      req.log.warn({ site: req.params.site, ap }, 'guest redirect for unknown site');
      return html(reply, renderMessage(locale, t(locale, 'portal.unknownTitle'), t(locale, 'portal.unknownBody')), 404);
    }
    const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, site.tenantId) });
    if (!tenant || tenant.status === 'suspended') {
      return html(reply, renderMessage(locale, t(locale, 'portal.suspendedTitle'), t(locale, 'portal.suspendedBody')), 403);
    }
    const session = await createGuestSession({
      tenantId: site.tenantId,
      consoleSiteId: site.id,
      clientMac: q.id,
      apMac: ap,
      ssid: q.ssid?.slice(0, 64) ?? null,
      originalUrl: safeUrl(q.url)?.slice(0, 2000) ?? null,
    });
    // Continue on the customer's own HTTPS hostname when it is ready, otherwise on this address
    const origin = (await tenantPortalOrigin(site.tenantId)) ?? '';
    const lang = normalizeLocale(q.lang);
    return reply.header('cache-control', 'no-store').redirect(`${origin}/portal/${session.token}${lang ? `?lang=${lang}` : ''}`);
  };
  app.get('/guest/s/:site', receive);
  app.get('/guest/s/:site/', receive);
  app.get('/guest/s/:site/*', receive);

  // On a customer hostname: shows the guest page without connecting, to check the hostname and SSL
  app.get<{ Querystring: { lang?: string } }>('/portal/preview', async (req, reply) => {
    const { tenantId } = await hostnameTenant(req.hostname);
    const locale = guestLocale(req, req.query.lang);
    if (!tenantId) return html(reply, renderMessage(locale, t(locale, 'portal.unknownTitle'), t(locale, 'portal.unknownBody')), 404);
    const p = await getPortalSettings(tenantId);
    return html(
      reply,
      renderLogin({
        locale,
        accent: p.accentColor,
        title: pick(p.title, locale) || t(locale, 'portal.defaultTitle'),
        welcome: pick(p.welcome, locale) || t(locale, 'portal.defaultWelcome'),
        terms: pick(p.terms, locale),
        requireTerms: p.requireTerms,
        action: '/portal/preview',
        path: '/portal/preview',
      }),
    );
  });

  app.post('/portal/preview', async (_req, reply) => reply.redirect('/portal/preview', 303));

  const loadSession = (token: string) => db.query.guestSessions.findFirst({ where: eq(schema.guestSessions.token, token) });

  app.get<{ Params: { token: string }; Querystring: { lang?: string } }>('/portal/:token', async (req, reply) => {
    const s = await loadSession(req.params.token);
    const locale = guestLocale(req, req.query.lang ?? s?.locale);
    if (!s || isExpired(s)) return html(reply, renderMessage(locale, t(locale, 'portal.expiredTitle'), t(locale, 'portal.expiredBody')), 410);
    if (s.status === 'authorized' && s.accessUntil && s.accessUntil > new Date()) return reply.redirect(`/portal/${s.token}/done`);
    const p = await getPortalSettings(s.tenantId);
    return html(
      reply,
      renderLogin({
        locale,
        accent: p.accentColor,
        title: pick(p.title, locale) || t(locale, 'portal.defaultTitle'),
        welcome: pick(p.welcome, locale) || t(locale, 'portal.defaultWelcome'),
        terms: pick(p.terms, locale),
        requireTerms: p.requireTerms,
        action: `/portal/${s.token}/connect`,
        path: `/portal/${s.token}`,
      }),
    );
  });

  app.post<{ Params: { token: string }; Body: { terms?: string; lang?: string } }>(
    '/portal/:token/connect',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const s = await loadSession(req.params.token);
      const body = (req.body ?? {}) as { terms?: string; lang?: string };
      const locale = guestLocale(req, body.lang ?? s?.locale);
      if (!s || isExpired(s)) return html(reply, renderMessage(locale, t(locale, 'portal.expiredTitle'), t(locale, 'portal.expiredBody')), 410);
      const p = await getPortalSettings(s.tenantId);
      const path = `/portal/${s.token}`;
      if (p.requireTerms && body.terms !== '1') {
        return html(
          reply,
          renderLogin({
            locale,
            accent: p.accentColor,
            title: pick(p.title, locale) || t(locale, 'portal.defaultTitle'),
            welcome: pick(p.welcome, locale) || t(locale, 'portal.defaultWelcome'),
            terms: pick(p.terms, locale),
            requireTerms: true,
            action: `${path}/connect`,
            path,
            error: t(locale, 'portal.mustAccept'),
          }),
          400,
        );
      }
      await db.update(schema.guestSessions).set({ locale }).where(eq(schema.guestSessions.id, s.id));
      const result = await authorizeSession(s);
      if (!result.ok) {
        req.log.warn({ session: s.id, error: result.error }, 'guest authorization failed');
        const retry = `<a class="btn" href="${esc(path)}?lang=${locale}">${esc(t(locale, 'portal.retry'))}</a>`;
        return html(reply, renderMessage(locale, t(locale, 'portal.failedTitle'), t(locale, 'portal.failedBody'), { extra: retry, accent: p.accentColor, path }), 502);
      }
      return reply.redirect(`${path}/done`, 303);
    },
  );

  app.get<{ Params: { token: string }; Querystring: { lang?: string } }>('/portal/:token/done', async (req, reply) => {
    const s = await loadSession(req.params.token);
    const locale = guestLocale(req, req.query.lang ?? s?.locale);
    if (!s || s.status !== 'authorized') return reply.redirect(`/portal/${req.params.token}`);
    const p = await getPortalSettings(s.tenantId);
    const next = safeUrl(p.successUrl) ?? safeUrl(s.originalUrl);
    const until = s.accessUntil
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: process.env.TZ || 'Europe/Amsterdam' }).format(s.accessUntil)
      : null;
    const extra = `${until ? `<p class="note">${esc(t(locale, 'portal.validUntil', { time: until }))}</p>` : ''}${
      next ? `<a class="btn" href="${esc(next)}">${esc(t(locale, 'portal.continue'))}</a>` : ''
    }`;
    return html(
      reply,
      renderMessage(locale, t(locale, 'portal.successTitle'), t(locale, 'portal.successBody'), {
        extra,
        accent: p.accentColor,
        path: `/portal/${s.token}/done`,
        refresh: next ? { seconds: 4, url: next } : undefined,
      }),
    );
  });
}
