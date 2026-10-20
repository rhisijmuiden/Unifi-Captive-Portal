import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, schema } from '../db/index.js';
import type { PortalSettings } from '../db/schema.js';
import { DEFAULT_LOCALE, normalizeLocale, t, type Locale } from '../i18n/index.js';
import { authorizeSession, createGuestSession, designFor, getPortalSettings, isExpired, resolveSite } from '../services/guests.js';
import { hostnameTenant, tenantPortalOrigin } from '../services/hostnames.js';
import { sendGuestMail } from '../services/notifications.js';
import { packageName, PaymentError, refreshPayment, startPayment, verifyStripeSignature } from '../services/payments.js';
import { adminBaseUrl } from '../services/settings.js';
import { getTenantSettings } from '../services/tenantSettings.js';
import { claimVoucher, releaseVoucher } from '../services/vouchers.js';
import { facebookConfigured, facebookLoginUrl, facebookProfile } from '../services/facebook.js';
import { guestStrings, moneyLabel, type GuestStrings } from '../shared/guestStrings.js';
import { pickText, type LoginContext, type LoginMethod } from '../shared/portalDesign.js';
import { esc, renderGuestPage, renderMessage } from '../views/portal.js';

type GuestQuery = { id?: string; ap?: string; ssid?: string; url?: string; t?: string; lang?: string };
type ConnectBody = Partial<Record<'method' | 'terms' | 'lang' | 'name' | 'email' | 'phone' | 'marketing' | 'code' | 'package', string>>;

const MAC_RE = /^([0-9a-f]{2}[:-]?){5}[0-9a-f]{2}$/i;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
const safeUrl = (u: string | null | undefined) => (u && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null);
const clean = (v: string | undefined, max: number) => (v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

/** Guest language: explicit ?lang= choice, then the browser's languages, limited to what the portal offers. */
function guestLocale(req: FastifyRequest, chosen: string | null | undefined, offered?: string[]): Locale {
  const allowed = (offered?.length ? offered : [DEFAULT_LOCALE]).map((l) => normalizeLocale(l)).filter(Boolean) as Locale[];
  const ok = (l: Locale | null): l is Locale => Boolean(l && allowed.includes(l));
  const pick = normalizeLocale(chosen);
  if (ok(pick)) return pick;
  const fromBrowser = String(req.headers['accept-language'] ?? '')
    .split(',')
    .map((part) => normalizeLocale(part.split(';')[0].trim()))
    .find(ok);
  return fromBrowser ?? allowed[0] ?? DEFAULT_LOCALE;
}

function html(reply: FastifyReply, body: string, status = 200) {
  return reply
    .code(status)
    .header('cache-control', 'no-store')
    .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self' https:; frame-ancestors 'none'; base-uri 'none'")
    .type('text/html; charset=utf-8')
    .send(body);
}

/** The address the guest is on, for links that must come back here (payment return). */
const ownOrigin = (req: FastifyRequest) => `${req.protocol}://${req.host}`;

async function loginContext(p: PortalSettings, locale: Locale, action: string): Promise<LoginContext> {
  let methods = p.auth.methods.filter((m, i, all) => all.indexOf(m) === i);
  let packages: LoginContext['packages'] = [];
  if (methods.includes('payment')) {
    const pay = await getTenantSettings(p.tenantId, 'payments');
    const configured = (pay.provider === 'mollie' && pay.mollieApiKey) || (pay.provider === 'stripe' && pay.stripeSecretKey);
    if (configured) {
      const rows = await db.query.paymentPackages.findMany({
        where: and(eq(schema.paymentPackages.tenantId, p.tenantId), eq(schema.paymentPackages.active, true)),
        orderBy: [asc(schema.paymentPackages.sortOrder), asc(schema.paymentPackages.priceCents)],
      });
      packages = rows.map((r) => ({ id: r.id, name: packageName(r, locale), price: moneyLabel(locale, r.priceCents, pay.currency), minutes: r.durationMinutes }));
    }
    if (!packages.length) methods = methods.filter((m) => m !== 'payment');
  }
  if (methods.includes('facebook') && !facebookConfigured(await getTenantSettings(p.tenantId, 'social'))) methods = methods.filter((m) => m !== 'facebook');
  return {
    methods,
    requireTerms: p.requireTerms,
    terms: pickText(p.terms, locale, p.languages[0] ?? DEFAULT_LOCALE),
    emailFields: { name: p.auth.emailName, phone: p.auth.emailPhone, marketing: p.auth.marketingOptIn },
    paymentEmail: p.auth.paymentEmail,
    packages,
    action,
  };
}

export async function guestPortalRoutes(app: FastifyInstance) {
  /**
   * UniFi sends a guest here when "External portal server" points at this server:
   * http://<server>/guest/s/<site>/?ap=<ap mac>&id=<client mac>&t=<time>&url=<page>&ssid=<ssid>
   */
  const receive = async (req: FastifyRequest<{ Params: { site: string }; Querystring: GuestQuery }>, reply: FastifyReply) => {
    const q = req.query;
    const locale = guestLocale(req, q.lang, Object.keys(guestStrings));
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

  // Images from the editor; guests load them before they have internet
  app.get<{ Params: { id: string } }>('/portal/media/:id', async (req, reply) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return reply.code(404).send();
    const row = await db.query.media.findFirst({ where: eq(schema.media.id, req.params.id) });
    if (!row) return reply.code(404).send();
    return reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      .header('cross-origin-resource-policy', 'cross-origin')
      .type(row.mime)
      .send(row.data);
  });

  const render = async (req: FastifyRequest, reply: FastifyReply, p: PortalSettings, opts: { locale: Locale; path: string; action: string; error?: string; active?: LoginMethod; values?: LoginContext['values']; status?: number }) => {
    const login = await loginContext(p, opts.locale, opts.action);
    const s = guestStrings[opts.locale];
    return html(
      reply,
      renderGuestPage({
        locale: opts.locale,
        design: designFor(p),
        languages: p.languages,
        path: opts.path,
        title: pickText(p.title, opts.locale, p.languages[0]) || s.defaultTitle,
        login: { ...login, error: opts.error, active: opts.active, values: opts.values },
      }),
      opts.status,
    );
  };

  // On a customer hostname: shows the guest page without connecting, to check the hostname and SSL
  app.get<{ Querystring: { lang?: string } }>('/portal/preview', async (req, reply) => {
    const { tenantId } = await hostnameTenant(req.hostname);
    if (!tenantId) {
      const locale = guestLocale(req, req.query.lang, Object.keys(guestStrings));
      return html(reply, renderMessage(locale, t(locale, 'portal.unknownTitle'), t(locale, 'portal.unknownBody')), 404);
    }
    const p = await getPortalSettings(tenantId);
    const locale = guestLocale(req, req.query.lang, p.languages);
    return render(req, reply, p, { locale, path: '/portal/preview', action: '/portal/preview' });
  });

  app.post('/portal/preview', async (_req, reply) => reply.redirect('/portal/preview', 303));

  const loadSession = (token: string) => db.query.guestSessions.findFirst({ where: eq(schema.guestSessions.token, token) });

  const expired = (reply: FastifyReply, locale: Locale) => html(reply, renderMessage(locale, t(locale, 'portal.expiredTitle'), t(locale, 'portal.expiredBody')), 410);

  app.get<{ Params: { token: string }; Querystring: { lang?: string } }>('/portal/:token', async (req, reply) => {
    const s = await loadSession(req.params.token);
    if (!s || isExpired(s)) return expired(reply, guestLocale(req, req.query.lang, Object.keys(guestStrings)));
    if (s.status === 'authorized' && s.accessUntil && s.accessUntil > new Date()) return reply.redirect(`/portal/${s.token}/done`);
    const p = await getPortalSettings(s.tenantId);
    const locale = guestLocale(req, req.query.lang ?? s.locale, p.languages);
    return render(req, reply, p, { locale, path: `/portal/${s.token}`, action: `/portal/${s.token}/connect` });
  });

  /** Connects the guest with the chosen method: free (click-through), e-mail, voucher or payment. */
  app.post<{ Params: { token: string }; Body: ConnectBody }>(
    '/portal/:token/connect',
    // Per guest page, not per IP: all guests of a location usually share one public IP address
    { config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => `connect:${(req.params as { token?: string }).token ?? req.ip}` } } },
    async (req, reply) => {
      const s = await loadSession(req.params.token);
      const body = (req.body ?? {}) as ConnectBody;
      if (!s || isExpired(s)) return expired(reply, guestLocale(req, body.lang, Object.keys(guestStrings)));
      const p = await getPortalSettings(s.tenantId);
      const locale = guestLocale(req, body.lang ?? s.locale, p.languages);
      const g: GuestStrings = guestStrings[locale];
      const path = `/portal/${s.token}`;
      const login = await loginContext(p, locale, `${path}/connect`);
      const method = (login.methods.includes(body.method as LoginMethod) ? body.method : login.methods.length === 1 ? login.methods[0] : null) as LoginMethod | null;
      const values = { name: clean(body.name, 120), email: clean(body.email, 254).toLowerCase(), phone: clean(body.phone, 40), code: clean(body.code, 32), package: clean(body.package, 40) };
      const fail = (error: string, status = 400) => render(req, reply, p, { locale, path, action: `${path}/connect`, error, active: method ?? undefined, values, status });

      if (!method) return fail(g.noMethods);
      if (p.requireTerms && body.terms !== '1') return fail(g.mustAccept);
      await db.update(schema.guestSessions).set({ locale }).where(eq(schema.guestSessions.id, s.id));

      const failed = (error: string) => {
        req.log.warn({ session: s.id, error }, 'guest authorization failed');
        const retry = `<a class="cp-btn" href="${esc(path)}?lang=${locale}">${esc(g.retry)}</a>`;
        return html(reply, renderMessage(locale, g.failedTitle, g.failedBody, { extra: retry, design: designFor(p), languages: p.languages, path }), 502);
      };

      if (method === 'free') {
        const result = await authorizeSession(s, { record: { method, locale } });
        return result.ok ? reply.redirect(`${path}/done`, 303) : failed(result.error);
      }

      if (method === 'email') {
        if (p.auth.emailName === 'required' && !values.name) return fail(g.nameRequired);
        if (!EMAIL_RE.test(values.email)) return fail(g.emailInvalid);
        if (p.auth.emailPhone === 'required' && !values.phone) return fail(g.phoneRequired);
        const result = await authorizeSession(s, {
          record: {
            method,
            locale,
            email: values.email,
            name: p.auth.emailName === 'off' ? null : values.name || null,
            phone: p.auth.emailPhone === 'off' ? null : values.phone || null,
            marketingOptIn: p.auth.marketingOptIn && body.marketing === '1',
          },
        });
        if (!result.ok) return failed(result.error);
        if (p.auth.welcomeMail) void sendGuestMail('guestWelcome', s.tenantId, values.email, locale, { name: values.name, email: values.email, validUntil: result.session.accessUntil });
        return reply.redirect(`${path}/done`, 303);
      }

      if (method === 'voucher') {
        const claim = await claimVoucher(s.tenantId, values.code);
        if (!claim.ok) return fail(g[claim.reason]);
        const v = claim.voucher;
        const result = await authorizeSession(s, {
          limits: { timeLimitMinutes: v.durationMinutes, dataLimitMb: v.dataLimitMb ?? p.dataLimitMb, downKbps: v.downKbps ?? p.downKbps, upKbps: v.upKbps ?? p.upKbps },
          record: { method, locale, voucherId: v.id },
        });
        if (!result.ok) {
          await releaseVoucher(v.id);
          return failed(result.error);
        }
        return reply.redirect(`${path}/done`, 303);
      }

      if (method === 'facebook') {
        // Short access first: the Facebook login page must load before the guest is connected
        try {
          const fb = await facebookLoginUrl(s.tenantId, s.token, locale);
          if (fb.graceMinutes > 0) {
            const grace = await authorizeSession(s, { temporary: true, retries: 1, limits: { timeLimitMinutes: fb.graceMinutes, downKbps: 2048, upKbps: 1024 } });
            if (!grace.ok) req.log.warn({ session: s.id, error: grace.error }, 'short access for Facebook failed; relying on pre-authorization');
          }
          return reply.header('cache-control', 'no-store').redirect(fb.url, 303);
        } catch (err) {
          req.log.error({ err, session: s.id }, 'starting Facebook login failed');
          return fail(g.facebookFailed);
        }
      }

      // Payment: create the checkout, give short access so the payment page loads, then send the guest there
      const pkg = await db.query.paymentPackages.findFirst({
        where: and(eq(schema.paymentPackages.id, /^[0-9a-f-]{36}$/.test(values.package) ? values.package : '00000000-0000-0000-0000-000000000000'), eq(schema.paymentPackages.tenantId, s.tenantId), eq(schema.paymentPackages.active, true)),
      });
      if (!pkg) return fail(g.packageInvalid);
      if (values.email ? !EMAIL_RE.test(values.email) : p.auth.paymentEmail === 'required') return fail(g.emailInvalid);
      try {
        const webhookBase = (await tenantPortalOrigin(s.tenantId)) ?? (await adminBaseUrl());
        const started = await startPayment({ session: s, pkg, email: values.email || null, locale, returnBase: ownOrigin(req), webhookBase });
        await db.update(schema.guestSessions).set({ paymentId: started.payment.id, email: values.email || s.email }).where(eq(schema.guestSessions.id, s.id));
        if (started.graceMinutes > 0) {
          const grace = await authorizeSession(s, { temporary: true, retries: 1, limits: { timeLimitMinutes: started.graceMinutes, downKbps: 2048, upKbps: 1024 } });
          if (!grace.ok) req.log.warn({ session: s.id, error: grace.error }, 'short access for payment failed; relying on pre-authorization');
        }
        return reply.header('cache-control', 'no-store').redirect(started.url, 303);
      } catch (err) {
        req.log.error({ err, session: s.id }, 'starting payment failed');
        return fail(g.paymentUnavailable, err instanceof PaymentError ? 502 : 400);
      }
    },
  );

  /** Facebook sends the guest back here with a code; state is the guest page token. */
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/portal/oauth/facebook', async (req, reply) => {
    const s = req.query.state ? await loadSession(req.query.state.slice(0, 100)) : null;
    if (!s || isExpired(s)) return expired(reply, guestLocale(req, null, Object.keys(guestStrings)));
    const p = await getPortalSettings(s.tenantId);
    const locale = guestLocale(req, s.locale, p.languages);
    const g = guestStrings[locale];
    const path = `/portal/${s.token}`;
    const again = () => render(req, reply, p, { locale, path, action: `${path}/connect`, error: g.facebookFailed, active: 'facebook', status: 400 });
    if (!req.query.code || req.query.error) return again();
    let profile: { id: string; name?: string; email?: string };
    try {
      profile = await facebookProfile(s.tenantId, req.query.code);
    } catch (err) {
      req.log.warn({ err, session: s.id }, 'facebook login failed');
      return again();
    }
    const result = await authorizeSession(s, { record: { method: 'facebook', locale, name: profile.name?.slice(0, 120) ?? null, email: profile.email?.toLowerCase().slice(0, 254) ?? null } });
    if (!result.ok) {
      const retry = `<a class="cp-btn" href="${esc(path)}?lang=${locale}">${esc(g.retry)}</a>`;
      return html(reply, renderMessage(locale, g.failedTitle, g.failedBody, { extra: retry, design: designFor(p), languages: p.languages, path }), 502);
    }
    return reply.redirect(`${path}/done`, 303);
  });

  /** The guest comes back from the payment page; the status is checked with the provider. */
  app.get<{ Params: { token: string }; Querystring: { p?: string; cancel?: string; lang?: string } }>('/portal/:token/pay/return', async (req, reply) => {
    const s = await loadSession(req.params.token);
    const pid = req.query.p && /^[0-9a-f-]{36}$/.test(req.query.p) ? req.query.p : null;
    const payment = s && pid ? await db.query.payments.findFirst({ where: and(eq(schema.payments.id, pid), eq(schema.payments.guestSessionId, s.id)) }) : null;
    if (!s || !payment) return expired(reply, guestLocale(req, req.query.lang, Object.keys(guestStrings)));
    const p = await getPortalSettings(s.tenantId);
    const locale = guestLocale(req, req.query.lang ?? payment.locale ?? s.locale, p.languages);
    const g = guestStrings[locale];
    const path = `/portal/${s.token}`;
    let current = payment;
    try {
      current = await refreshPayment(payment);
    } catch (err) {
      req.log.warn({ err, payment: payment.id }, 'payment status check failed');
    }
    if (current.status === 'paid') {
      const fresh = await loadSession(s.token);
      if (fresh?.status === 'authorized') return reply.redirect(`${path}/done`, 303);
      return html(reply, renderMessage(locale, g.failedTitle, g.failedBody, { extra: `<a class="cp-btn" href="${esc(req.url)}">${esc(g.retry)}</a>`, design: designFor(p), languages: p.languages, path: req.url.split('?')[0] }), 502);
    }
    if (current.status === 'open' && req.query.cancel !== '1') {
      const self = `${path}/pay/return?p=${payment.id}&lang=${locale}`;
      return html(reply, renderMessage(locale, g.paymentPendingTitle, g.paymentPendingBody, { design: designFor(p), languages: p.languages, path, refresh: { seconds: 3, url: self } }));
    }
    const retry = `<a class="cp-btn" href="${esc(path)}?lang=${locale}">${esc(g.retry)}</a>`;
    return html(reply, renderMessage(locale, g.paymentFailedTitle, g.paymentFailedBody, { extra: retry, design: designFor(p), languages: p.languages, path }));
  });

  // Mollie posts the payment id; we fetch the real status ourselves
  app.post<{ Body: { id?: string } }>('/portal/webhooks/mollie', async (req, reply) => {
    const id = typeof req.body?.id === 'string' ? req.body.id.slice(0, 64) : '';
    const payment = id ? await db.query.payments.findFirst({ where: and(eq(schema.payments.provider, 'mollie'), eq(schema.payments.providerRef, id)) }) : null;
    if (payment) await refreshPayment(payment).catch((err) => req.log.error({ err, payment: payment.id }, 'mollie webhook'));
    return reply.code(200).send('ok');
  });

  // Stripe: signed with the customer's webhook secret; the raw body is needed for the signature
  await app.register(async (sub) => {
    sub.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 256_000 }, (_req, body, done) => done(null, body));
    sub.post<{ Params: { tenantId: string }; Body: string }>('/portal/webhooks/stripe/:tenantId', async (req, reply) => {
      if (!/^[0-9a-f-]{36}$/.test(req.params.tenantId)) return reply.code(404).send();
      const settings = await getTenantSettings(req.params.tenantId, 'payments');
      if (!verifyStripeSignature(String(req.body), req.headers['stripe-signature'] as string | undefined, settings.stripeWebhookSecret)) return reply.code(400).send('bad signature');
      const event = JSON.parse(String(req.body)) as { type?: string; data?: { object?: { id?: string } } };
      const ref = event.data?.object?.id;
      if (ref && event.type?.startsWith('checkout.session.')) {
        const payment = await db.query.payments.findFirst({ where: and(eq(schema.payments.provider, 'stripe'), eq(schema.payments.providerRef, ref), eq(schema.payments.tenantId, req.params.tenantId)) });
        if (payment) await refreshPayment(payment).catch((err) => req.log.error({ err, payment: payment.id }, 'stripe webhook'));
      }
      return reply.code(200).send({ received: true });
    });
  });

  app.get<{ Params: { token: string }; Querystring: { lang?: string } }>('/portal/:token/done', async (req, reply) => {
    const s = await loadSession(req.params.token);
    if (!s || s.status !== 'authorized') return reply.redirect(`/portal/${req.params.token}`);
    const p = await getPortalSettings(s.tenantId);
    const locale = guestLocale(req, req.query.lang ?? s.locale, p.languages);
    const g = guestStrings[locale];
    const next = safeUrl(p.successUrl) ?? safeUrl(s.originalUrl);
    const until = s.accessUntil
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: process.env.TZ || 'Europe/Amsterdam' }).format(s.accessUntil)
      : null;
    const extra = `${until ? `<p class="cp-note">${esc(g.validUntil.replace('{{time}}', until))}</p>` : ''}${
      next ? `<a class="cp-btn" href="${esc(next)}">${esc(g.continue)}</a>` : ''
    }`;
    const title = s.method === 'payment' ? g.paymentPaidTitle : g.successTitle;
    return html(
      reply,
      renderMessage(locale, title, g.successBody, {
        extra,
        design: designFor(p),
        languages: p.languages,
        path: `/portal/${s.token}/done`,
        refresh: next ? { seconds: 4, url: next } : undefined,
      }),
    );
  });
}

