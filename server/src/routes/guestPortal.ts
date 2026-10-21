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
import { devicesOnStay, findStay, normalizeRoom, roomFailed, roomLocked, syncIfStale } from '../services/hotel.js';
import { maskPhone, pendingCode, sendGuestCode, smsConfigured, verifyGuestCode } from '../services/sms.js';
import { countAd, pickAd } from '../services/ads.js';
import { designedByFor } from '../services/resellers.js';
import { completePrivacyRequest, createPrivacyRequest, findPrivacyRequest, knowsEmail } from '../services/marketing.js';
import { audit } from '../lib/auth.js';
import type { GuestSession, PortalAd } from '../db/schema.js';
import { oidcConfigured, oidcLoginUrl, oidcProfile, oidcProviders, type OidcProvider } from '../services/socialLogin.js';
import { fill, guestStrings, moneyLabel, type GuestStrings } from '../shared/guestStrings.js';
import { pickText, type LoginContext, type LoginMethod } from '../shared/portalDesign.js';
import { esc, renderGuestPage, renderMessage } from '../views/portal.js';

type GuestQuery = { id?: string; ap?: string; ssid?: string; url?: string; t?: string; lang?: string };
type ConnectBody = Partial<Record<'method' | 'terms' | 'lang' | 'name' | 'email' | 'phone' | 'marketing' | 'code' | 'package' | 'room' | 'surname' | 'resend', string>>;

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
    .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; media-src 'self'; form-action 'self' https:; frame-ancestors 'none'; base-uri 'none'")
    .type('text/html; charset=utf-8')
    .send(body);
}

/** The customer's privacy page, linked in the guest portal footer. */
const slugs = new Map<string, string>();
async function privacyPath(tenantId: string) {
  let slug = slugs.get(tenantId);
  if (!slug) {
    const t = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, tenantId), columns: { slug: true } });
    if (!t) return undefined;
    slug = t.slug;
    slugs.set(tenantId, slug);
  }
  return `/portal/privacy/${slug}`;
}

/** An advert's image or video; "after" adverts link through the click counter. */
function adHtml(ad: PortalAd, label: string, token?: string) {
  const src = `/portal/media/${ad.mediaId}`;
  const media =
    ad.kind === 'video'
      ? `<video src="${src}" autoplay muted playsinline${ad.placement === 'after' ? ' loop' : ''} controls preload="auto"></video>`
      : `<img src="${src}" alt="${esc(ad.name)}">`;
  const linked = ad.placement === 'after' && token && safeUrl(ad.linkUrl) ? `<a href="/portal/ad/${ad.id}/click?s=${encodeURIComponent(token)}" rel="noopener">${media}</a>` : media;
  return `<div class="cp-ad">${linked}<small>${esc(label)}</small></div>`;
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
  if (methods.some((m) => m === 'facebook' || (oidcProviders as string[]).includes(m))) {
    const social = await getTenantSettings(p.tenantId, 'social');
    methods = methods.filter((m) => (m === 'facebook' ? facebookConfigured(social) : (oidcProviders as string[]).includes(m) ? oidcConfigured(social, m as OidcProvider) : true));
  }
  let smsCountry: string | undefined;
  if (methods.includes('sms')) {
    const sms = await getTenantSettings(p.tenantId, 'sms');
    if (smsConfigured(sms)) smsCountry = sms.defaultCountry;
    else methods = methods.filter((m) => m !== 'sms');
  }
  return {
    smsCountry,
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
    // Also while the portal is paused for unpaid invoices
    if (!tenant || tenant.status === 'suspended' || tenant.billingSuspendedAt) {
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
    reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      .header('cross-origin-resource-policy', 'cross-origin')
      .header('accept-ranges', 'bytes')
      .type(row.mime);
    // Videos: iPhones only play what can be fetched in ranges
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range && (range[1] || range[2])) {
      const size = row.data.length;
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(end, size - 1);
      if (start > end) return reply.code(416).header('content-range', `bytes */${size}`).send();
      return reply.code(206).header('content-range', `bytes ${start}-${end}/${size}`).send(row.data.subarray(start, end + 1));
    }
    return reply.send(row.data);
  });

  const render = async (
    req: FastifyRequest,
    reply: FastifyReply,
    p: PortalSettings,
    opts: { locale: Locale; path: string; action: string; error?: string; active?: LoginMethod; values?: LoginContext['values']; status?: number; smsSent?: LoginContext['smsSent'] },
  ) => {
    const login = await loginContext(p, opts.locale, opts.action);
    const s = guestStrings[opts.locale];
    return html(
      reply,
      renderGuestPage({
        privacyHref: await privacyPath(p.tenantId), designedBy: await designedByFor(p.tenantId),
        locale: opts.locale,
        design: designFor(p),
        languages: p.languages,
        path: opts.path,
        title: pickText(p.title, opts.locale, p.languages[0]) || s.defaultTitle,
        login: { ...login, error: opts.error, active: opts.active, values: opts.values, smsSent: opts.smsSent },
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
    // A splash advert once per guest page, before the sign-in options
    if (!s.adSeenAt) {
      const ad = await pickAd(s.tenantId, 'before');
      await db.update(schema.guestSessions).set({ adSeenAt: new Date() }).where(eq(schema.guestSessions.id, s.id));
      if (ad) {
        void countAd(ad.id, 'views').catch(() => undefined);
        const g = guestStrings[locale];
        const seconds = Math.max(0, Math.min(60, ad.seconds));
        const gate = `<div class="cp-gate" style="--wait:${seconds}s">${seconds ? `<p class="cp-wait">${esc(fill(g.adWait, { n: seconds }))}</p>` : ''}<a class="cp-btn" href="/portal/${esc(s.token)}?lang=${locale}">${esc(g.adContinue)}</a></div>`;
        return html(reply, renderMessage(locale, '', '', { extra: adHtml(ad, g.adLabel) + gate, design: designFor(p), languages: p.languages, path: `/portal/${s.token}`, privacyHref: await privacyPath(s.tenantId), designedBy: await designedByFor(s.tenantId) }));
      }
    }
    // A code was sent but not entered yet (e.g. after switching language): ask for it again
    const pending = p.auth.methods.includes('sms') ? await pendingCode(s.id) : null;
    return render(req, reply, p, {
      locale,
      path: `/portal/${s.token}`,
      action: `/portal/${s.token}/connect`,
      ...(pending && { active: 'sms' as const, values: { phone: pending.phone }, smsSent: { masked: maskPhone(pending.phone), canResend: pending.canResend } }),
    });
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
      const values = {
        name: clean(body.name, 120),
        email: clean(body.email, 254).toLowerCase(),
        phone: clean(body.phone, 40),
        code: clean(body.code, 32),
        package: clean(body.package, 40),
        room: clean(body.room, 20),
        surname: clean(body.surname, 80),
      };
      const fail = (error: string, status = 400, smsSent?: LoginContext['smsSent']) => render(req, reply, p, { locale, path, action: `${path}/connect`, error, active: method ?? undefined, values, status, smsSent });

      if (!method) return fail(g.noMethods);
      // The SMS code step comes after the terms were accepted with the phone number
      const smsCodeStep = method === 'sms' && Boolean(values.code) && body.resend !== '1';
      if (p.requireTerms && body.terms !== '1' && !smsCodeStep && !(method === 'sms' && body.resend === '1')) return fail(g.mustAccept);
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

      if (method === 'sms') {
        if (smsCodeStep) {
          const checked = await verifyGuestCode(s, values.code);
          if (!checked.ok) {
            const pending = await pendingCode(s.id);
            values.code = '';
            return fail(g[checked.reason], 400, pending ? { masked: maskPhone(pending.phone), canResend: pending.canResend } : undefined);
          }
          const result = await authorizeSession(s, { record: { method, locale, phone: checked.phone } });
          return result.ok ? reply.redirect(`${path}/done`, 303) : failed(result.error);
        }
        try {
          const sent = await sendGuestCode(s, values.phone, g.smsText);
          if (!sent.ok) {
            const pending = sent.reason === 'smsWait' ? await pendingCode(s.id) : null;
            return fail(g[sent.reason], sent.reason === 'phoneInvalid' ? 400 : 429, pending ? { masked: maskPhone(pending.phone), canResend: pending.canResend } : undefined);
          }
          values.phone = sent.phone;
          return render(req, reply, p, { locale, path, action: `${path}/connect`, active: 'sms', values, smsSent: { masked: maskPhone(sent.phone), canResend: sent.canResend } });
        } catch (err) {
          req.log.error({ err, session: s.id }, 'sending SMS code failed');
          return fail(g.smsUnavailable, 502);
        }
      }

      if (method === 'room') {
        if (!values.room || !values.surname) return fail(g.roomInvalid);
        if (roomLocked(s.tenantId, values.room)) return fail(g.roomLocked, 429);
        let stay = await findStay(s.tenantId, values.room, values.surname);
        // Just checked in and the PMS has not been synced since: look again
        if (!stay && (await syncIfStale(s.tenantId))) stay = await findStay(s.tenantId, values.room, values.surname);
        if (!stay) {
          roomFailed(s.tenantId, values.room);
          return fail(g.roomInvalid);
        }
        const hotel = await getTenantSettings(s.tenantId, 'hotel');
        if ((await devicesOnStay(stay.id, s.clientMac)) >= hotel.devicesPerRoom) return fail(g.roomFull, 403);
        const minutes = Math.max(5, Math.ceil((stay.departure.getTime() - Date.now()) / 60_000));
        const result = await authorizeSession(s, {
          limits: { timeLimitMinutes: minutes, dataLimitMb: p.dataLimitMb, downKbps: p.downKbps, upKbps: p.upKbps },
          record: { method, locale, name: stay.surname, hotelStayId: stay.id },
        });
        req.log.info({ session: s.id, room: normalizeRoom(values.room) }, 'hotel guest signed in');
        return result.ok ? reply.redirect(`${path}/done`, 303) : failed(result.error);
      }

      if ((oidcProviders as string[]).includes(method) || method === 'facebook') {
        // The newsletter checkbox travels with the session to the provider and back
        await db.update(schema.guestSessions).set({ marketingOptIn: p.auth.marketingOptIn && body.marketing === '1' }).where(eq(schema.guestSessions.id, s.id));
      }

      if ((oidcProviders as string[]).includes(method)) {
        try {
          const started = await oidcLoginUrl(s.tenantId, method as OidcProvider, s.token, locale);
          if (started.graceMinutes > 0) {
            const grace = await authorizeSession(s, { temporary: true, retries: 1, limits: { timeLimitMinutes: started.graceMinutes, downKbps: 2048, upKbps: 1024 } });
            if (!grace.ok) req.log.warn({ session: s.id, error: grace.error }, `short access for ${method} failed; relying on pre-authorization`);
          }
          return reply.header('cache-control', 'no-store').redirect(started.url, 303);
        } catch (err) {
          req.log.error({ err, session: s.id }, `starting ${method} login failed`);
          return fail(g.socialFailed);
        }
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

  /** Google and Microsoft send the guest back with a code (GET); Apple posts a form (form_post). */
  const oidcCallback = async (req: FastifyRequest, reply: FastifyReply, provider: OidcProvider, q: { code?: string; state?: string; error?: string; user?: string }) => {
    const s = q.state ? await loadSession(String(q.state).slice(0, 100)) : null;
    if (!s || isExpired(s)) return expired(reply, guestLocale(req, null, Object.keys(guestStrings)));
    if (s.status === 'authorized' && s.accessUntil && s.accessUntil > new Date()) return reply.redirect(`/portal/${s.token}/done`, 303);
    const p = await getPortalSettings(s.tenantId);
    const locale = guestLocale(req, s.locale, p.languages);
    const g = guestStrings[locale];
    const path = `/portal/${s.token}`;
    const again = () => render(req, reply, p, { locale, path, action: `${path}/connect`, error: g.socialFailed, active: provider, status: 400 });
    if (!q.code || q.error) return again();
    let profile: { id: string; name?: string; email?: string };
    try {
      profile = await oidcProfile(s.tenantId, provider, String(q.code).slice(0, 2000), typeof q.user === 'string' ? q.user.slice(0, 2000) : undefined);
    } catch (err) {
      req.log.warn({ err, session: s.id }, `${provider} login failed`);
      return again();
    }
    const result = await authorizeSession(s, { record: { method: provider, locale, name: profile.name?.slice(0, 120) ?? null, email: profile.email?.toLowerCase().slice(0, 254) ?? null } });
    if (!result.ok) {
      const retry = `<a class="cp-btn" href="${esc(path)}?lang=${locale}">${esc(g.retry)}</a>`;
      return html(reply, renderMessage(locale, g.failedTitle, g.failedBody, { extra: retry, design: designFor(p), languages: p.languages, path }), 502);
    }
    return reply.redirect(`${path}/done`, 303);
  };
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/portal/oauth/google', (req, reply) => oidcCallback(req, reply, 'google', req.query));
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/portal/oauth/microsoft', (req, reply) => oidcCallback(req, reply, 'microsoft', req.query));
  app.post<{ Body: { code?: string; state?: string; error?: string; user?: string } }>('/portal/oauth/apple', (req, reply) => oidcCallback(req, reply, 'apple', req.body ?? {}));

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

  /**
   * "You are connected": validity, an optional survey (then a Google review link), an
   * optional advert and the button onwards. Only a plain page forwards by itself.
   */
  const donePage = async (req: FastifyRequest, reply: FastifyReply, s: GuestSession, opts: { lang?: string; thanks?: boolean } = {}) => {
    const p = await getPortalSettings(s.tenantId);
    const locale = guestLocale(req, opts.lang ?? s.locale, p.languages);
    const g = guestStrings[locale];
    const path = `/portal/${s.token}`;
    const next = safeUrl(p.successUrl) ?? safeUrl(s.originalUrl);
    const until = s.accessUntil
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: process.env.TZ || 'Europe/Amsterdam' }).format(s.accessUntil)
      : null;
    const survey = await getTenantSettings(s.tenantId, 'survey');
    const answered = Boolean(await db.query.surveyResponses.findFirst({ where: eq(schema.surveyResponses.guestSessionId, s.id), columns: { id: true } }));
    const review = survey.reviewButton && safeUrl(survey.googleReviewUrl);
    const reviewBtn = review ? `<a class="cp-btn cp-btn-review" href="${esc(review)}" rel="noopener" target="_blank">${esc(g.reviewButton)}</a>` : '';
    let middle = '';
    if (opts.thanks) {
      middle = `<p class="cp-note">${esc(g.surveyThanksBody)}</p>${review ? `<p class="cp-note">${esc(g.reviewAsk)}</p>${reviewBtn}` : ''}`;
    } else if (survey.enabled && !answered) {
      const question = pickText(survey.question, locale, p.languages[0] ?? DEFAULT_LOCALE) || g.surveyDefault;
      const stars = [5, 4, 3, 2, 1]
        .map((n) => `<input type="radio" name="rating" value="${n}" id="cp-r${n}" required><label for="cp-r${n}" title="${esc(fill(g.surveyStars, { n }))}">★</label>`)
        .join('');
      const comment = survey.allowComment ? `<label class="cp-field"><span>${esc(g.surveyComment)} <small>(${esc(g.optional)})</small></span><textarea class="cp-input" name="comment" maxlength="1000"></textarea></label>` : '';
      middle = `<form method="post" action="${esc(path)}/survey" class="cp-panel cp-solo" style="margin-top:18px"><input type="hidden" name="lang" value="${locale}"><p class="cp-field"><span>${esc(question)}</span></p><div class="cp-stars" role="radiogroup" aria-label="${esc(g.surveyRate)}">${stars}</div>${comment}<button class="cp-btn" type="submit">${esc(g.surveySend)}</button></form>`;
    } else if (review && !answered) {
      middle = `<p class="cp-note">${esc(g.reviewAsk)}</p>${reviewBtn}`;
    }
    const ad = await pickAd(s.tenantId, 'after');
    if (ad) void countAd(ad.id, 'views').catch(() => undefined);
    const onwards = next ? `<a class="cp-btn${middle ? ' cp-btn-outline' : ''}" style="margin-top:16px" href="${esc(next)}">${esc(g.continue)}</a>` : '';
    const extra = `${until ? `<p class="cp-note">${esc(g.validUntil.replace('{{time}}', until))}</p>` : ''}${ad ? adHtml(ad, g.adLabel, s.token) : ''}${middle}${onwards}`;
    const title = opts.thanks ? g.surveyThanksTitle : s.method === 'payment' ? g.paymentPaidTitle : g.successTitle;
    const refresh = next && !middle && !ad ? { seconds: 4, url: next } : undefined;
    return html(
      reply,
      renderMessage(locale, title, opts.thanks ? '' : refresh ? g.successBody : g.successBodyStay, {
        extra,
        design: designFor(p),
        languages: p.languages,
        path: `${path}/done`,
        privacyHref: await privacyPath(s.tenantId), designedBy: await designedByFor(s.tenantId),
        refresh,
      }),
    );
  };

  app.get<{ Params: { token: string }; Querystring: { lang?: string } }>('/portal/:token/done', async (req, reply) => {
    const s = await loadSession(req.params.token);
    if (!s || s.status !== 'authorized') return reply.redirect(`/portal/${req.params.token}`);
    return donePage(req, reply, s, { lang: req.query.lang });
  });

  app.post<{ Params: { token: string }; Body: { rating?: string; comment?: string; lang?: string } }>(
    '/portal/:token/survey',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const s = await loadSession(req.params.token);
      if (!s || s.status !== 'authorized') return reply.redirect(`/portal/${req.params.token}`, 303);
      const rating = Number(req.body?.rating);
      if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
        await db
          .insert(schema.surveyResponses)
          .values({ tenantId: s.tenantId, guestSessionId: s.id, rating, comment: clean(req.body?.comment, 1000).replace(/\s+/g, ' ') || null, locale: s.locale })
          .onConflictDoNothing();
        return donePage(req, reply, s, { lang: req.body?.lang, thanks: true });
      }
      return donePage(req, reply, s, { lang: req.body?.lang });
    },
  );

  /** A click on an advert on the "connected" page: counted, then on to the advertiser. */
  app.get<{ Params: { id: string }; Querystring: { s?: string } }>('/portal/ad/:id/click', async (req, reply) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return reply.code(404).send();
    const ad = await db.query.portalAds.findFirst({ where: eq(schema.portalAds.id, req.params.id) });
    const target = ad && safeUrl(ad.linkUrl);
    if (!ad || !target) return reply.code(404).send();
    const s = req.query.s ? await loadSession(String(req.query.s).slice(0, 100)) : null;
    if (s?.tenantId === ad.tenantId) await countAd(ad.id, 'clicks');
    return reply.header('cache-control', 'no-store').redirect(target);
  });

  // ── Privacy: guests ask for their data to be erased (GDPR art. 17) ──

  const privacyTenant = async (req: FastifyRequest, slug?: string) => {
    if (slug) {
      const t = await db.query.tenants.findFirst({ where: eq(schema.tenants.slug, slug.slice(0, 80)), columns: { id: true } });
      return t?.id ?? null;
    }
    return (await hostnameTenant(req.hostname)).tenantId ?? null;
  };

  const privacyPage = async (req: FastifyRequest, reply: FastifyReply, tenantId: string | null, lang: string | undefined, view: 'form' | 'sent', error?: string) => {
    if (!tenantId) {
      const locale = guestLocale(req, lang, Object.keys(guestStrings));
      return html(reply, renderMessage(locale, t(locale, 'portal.unknownTitle'), t(locale, 'portal.unknownBody')), 404);
    }
    const p = await getPortalSettings(tenantId);
    const locale = guestLocale(req, lang, p.languages);
    const g = guestStrings[locale];
    const path = req.url.split('?')[0];
    const opts = { design: designFor(p), languages: p.languages, path, designedBy: await designedByFor(tenantId) };
    if (view === 'sent') return html(reply, renderMessage(locale, g.privacySentTitle, g.privacySentBody, opts));
    const form = `<form method="post" action="${esc(path)}" class="cp-panel cp-solo" style="margin-top:14px">${error ? `<p class="cp-alert" role="alert">${esc(error)}</p>` : ''}<input type="hidden" name="lang" value="${locale}"><label class="cp-field"><span>${esc(g.email)}</span><input class="cp-input" type="email" name="email" required autocomplete="email" maxlength="254"></label><button class="cp-btn" type="submit">${esc(g.privacyRequest)}</button></form>`;
    return html(reply, renderMessage(locale, g.privacyTitle, g.privacyIntro, { ...opts, extra: form }), error ? 400 : 200);
  };

  const privacyLimit = { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } };
  const requestErase = async (req: FastifyRequest<{ Body: { email?: string; lang?: string } }>, reply: FastifyReply, slug?: string) => {
    const tenantId = await privacyTenant(req, slug);
    const email = clean(req.body?.email, 254).toLowerCase();
    if (!tenantId) return privacyPage(req, reply, null, req.body?.lang, 'form');
    const p = await getPortalSettings(tenantId);
    const locale = guestLocale(req, req.body?.lang, p.languages);
    if (!EMAIL_RE.test(email)) return privacyPage(req, reply, tenantId, locale, 'form', guestStrings[locale].emailInvalid);
    // The same answer whether or not we know the address, so nobody can test addresses here
    if (await knowsEmail(tenantId, email)) {
      const token = await createPrivacyRequest(tenantId, email);
      const origin = (await tenantPortalOrigin(tenantId)) ?? (await adminBaseUrl());
      void sendGuestMail('guestPrivacy', tenantId, email, locale, { name: '', email, validUntil: null, actionUrl: `${origin}/portal/privacy/confirm/${token}?lang=${locale}` });
    }
    return privacyPage(req, reply, tenantId, locale, 'sent');
  };
  app.get<{ Querystring: { lang?: string } }>('/portal/privacy', async (req, reply) => privacyPage(req, reply, await privacyTenant(req), req.query.lang, 'form'));
  app.post<{ Body: { email?: string; lang?: string } }>('/portal/privacy', privacyLimit, (req, reply) => requestErase(req, reply));
  app.get<{ Params: { slug: string }; Querystring: { lang?: string } }>('/portal/privacy/:slug', async (req, reply) => privacyPage(req, reply, await privacyTenant(req, req.params.slug), req.query.lang, 'form'));
  app.post<{ Params: { slug: string }; Body: { email?: string; lang?: string } }>('/portal/privacy/:slug', privacyLimit, (req, reply) => requestErase(req, reply, req.params.slug));

  // The link in the e-mail shows a button; the erase itself is a POST, so link scanners cannot trigger it
  const confirmPage = async (req: FastifyRequest<{ Params: { token: string }; Querystring: { lang?: string } }>, reply: FastifyReply, erase: boolean) => {
    const r = await findPrivacyRequest(req.params.token.slice(0, 100));
    const p = r ? await getPortalSettings(r.tenantId) : null;
    const locale = guestLocale(req, req.query.lang, p?.languages ?? Object.keys(guestStrings));
    const g = guestStrings[locale];
    const opts = p ? { design: designFor(p), languages: p.languages, path: req.url.split('?')[0], designedBy: await designedByFor(p.tenantId) } : {};
    if (!r || r.expired || r.status !== 'pending' || !r.email) return html(reply, renderMessage(locale, g.privacyExpiredTitle, g.privacyExpiredBody, opts), 410);
    if (!erase) {
      const form = `<form method="post" action="${esc(req.url.split('?')[0])}?lang=${locale}"><button class="cp-btn" type="submit">${esc(g.privacyConfirm)}</button></form>`;
      return html(reply, renderMessage(locale, g.privacyConfirmTitle, g.privacyConfirmBody, { ...opts, extra: form }));
    }
    const result = await completePrivacyRequest(r.id);
    if (result) await audit(req, 'privacy.erased', { sessions: result.sessions, via: 'guest', providerError: result.providerError }, r.tenantId);
    return html(reply, renderMessage(locale, g.privacyDoneTitle, g.privacyDoneBody, opts));
  };
  app.get<{ Params: { token: string }; Querystring: { lang?: string } }>('/portal/privacy/confirm/:token', (req, reply) => confirmPage(req, reply, false));
  app.post<{ Params: { token: string }; Querystring: { lang?: string } }>('/portal/privacy/confirm/:token', privacyLimit, (req, reply) => confirmPage(req, reply, true));
}
