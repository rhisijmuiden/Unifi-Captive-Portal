import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { config } from './config.js';
import { loadUser, passwordChangeRequired } from './lib/auth.js';
import { apiKeyGate, API_V1, isApiV1, logApiRequest } from './api/gate.js';
import { requestLocale, t } from './i18n/index.js';
import { AppError } from './lib/errors.js';
import { apiRoutes } from './routes/api.js';
import { authRoutes } from './routes/auth.js';
import { backupRoutes } from './routes/backups.js';
import { billingRoutes } from './routes/billing.js';
import { consoleRoutes } from './routes/consoles.js';
import { editorRoutes } from './routes/editor.js';
import { guestPortalRoutes } from './routes/guestPortal.js';
import { liveRoutes } from './routes/live.js';
import { hostnameRoutes } from './routes/hostnames.js';
import { mailTemplateRoutes } from './routes/mailTemplates.js';
import { notificationRoutes } from './routes/notifications.js';
import { paymentRoutes } from './routes/payments.js';
import { portalRoutes } from './routes/portal.js';
import { securityRoutes } from './routes/security.js';
import { settingsRoutes } from './routes/settings.js';
import { socialRoutes } from './routes/social.js';
import { smsRoutes } from './routes/sms.js';
import { hotelRoutes } from './routes/hotel.js';
import { marketingRoutes } from './routes/marketing.js';
import { adRoutes } from './routes/ads.js';
import { systemRoutes } from './routes/system.js';
import { resellerRoutes } from './routes/resellers.js';
import { tenantRoutes } from './routes/tenants.js';
import { userRoutes } from './routes/users.js';
import { voucherRoutes } from './routes/vouchers.js';
import { cachedHosting, hostnameTenant } from './services/hostnames.js';
import { needsTwoFactorSetup } from './services/twoFactor.js';

const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// The only paths a customer hostname serves; the admin panel stays on the platform's own address
const PORTAL_PATH = /^\/(portal|guest)\/|^\/api\/health$/;
const TWO_FACTOR_OPEN = /^\/api\/(auth\/|system\/info$|health$)/;

export async function buildApp() {
  const app = Fastify({
    // /api/v1/… is the public REST API: the same routes as the interface, reached with an API key
    rewriteUrl: (req) => (req.url && API_V1.test(req.url) ? req.url.replace(API_V1, '/api/') : (req.url ?? '/')),
    // Only Caddy on this machine may set X-Forwarded-* headers
    trustProxy: '127.0.0.1',
    logger: config.isDev ? { transport: { target: 'pino-pretty' } } : { level: 'info' },
  });

  await app.register(cookie, { secret: config.appSecret });
  await app.register(rateLimit, { global: false });
  await app.register(formbody, { bodyLimit: 16_384 });

  app.decorateRequest('user', null);
  app.decorateRequest('apiKey', null);
  app.decorateRequest('sessionMethod', null);
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/caddy/')) return;
    const host = req.hostname;
    const tenantHost = await hostnameTenant(host);
    if (tenantHost.tenantId) {
      if (!PORTAL_PATH.test(req.url)) return reply.code(404).type('text/plain').send('Not found');
      if (req.protocol === 'http' && tenantHost.active && req.url.startsWith('/portal/')) return reply.redirect(`https://${host}${req.url}`, 301);
      return;
    }
    const hosting = await cachedHosting();
    // The admin panel on its own hostname is always served over HTTPS; guest redirects from UniFi stay on HTTP
    if (hosting.forceHttps && hosting.adminHostname && host === hosting.adminHostname && req.protocol === 'http' && !req.url.startsWith('/guest/')) {
      return reply.redirect(`https://${host}${req.url}`, 301);
    }
  });
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    // API requests carry a key instead of a session cookie, so they cannot be forged cross-site
    if (isApiV1(req)) return apiKeyGate(req, reply);
    // A custom header cannot be sent cross-site without a CORS preflight, which we never allow
    if (MUTATING.has(req.method) && req.headers['x-requested-with'] !== 'captive-portal') {
      return reply.code(403).send({ error: t(requestLocale(req), 'errors.invalidRequest') });
    }
    req.user = await loadUser(req);
    // Someone signed in with a generated password first chooses their own (or signs out)
    if (req.user && !TWO_FACTOR_OPEN.test(req.url) && passwordChangeRequired(req.user, req.sessionMethod ?? 'password')) {
      return reply.code(403).send({ error: t(requestLocale(req), 'errors.passwordChange'), code: 'password_change' });
    }
    // Someone who must use two-factor sign-in can only set it up (and sign out) until they have
    if (req.user && !TWO_FACTOR_OPEN.test(req.url) && (await needsTwoFactorSetup(req.user, req.sessionMethod ?? 'password'))) {
      return reply.code(403).send({ error: t(requestLocale(req), 'errors.twoFactorSetup'), code: 'two_factor_setup' });
    }
  });
  app.addHook('onResponse', async (req, reply) => {
    if (req.apiKey) await logApiRequest(req, reply).catch((err) => req.log.error(err));
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
  });

  app.setErrorHandler((err, req, reply) => {
    const locale = requestLocale(req);
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      // Schema messages that are translation keys ("errors.…") are translated; others become a generic message
      const error = issue?.message.startsWith('errors.')
        ? t(locale, issue.message as Parameters<typeof t>[1])
        : t(locale, 'errors.invalidInput', { field: issue?.path.join('.') || '?' });
      return reply.code(400).send({ error, issues: err.issues });
    }
    if (err instanceof AppError) return reply.code(err.statusCode).send({ error: t(locale, err.key, err.params) });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? t(locale, 'errors.serverError') : (err as Error).message });
  });

  await app.register(authRoutes);
  await app.register(resellerRoutes);
  await app.register(tenantRoutes);
  await app.register(userRoutes);
  await app.register(settingsRoutes);
  await app.register(systemRoutes);
  await app.register(consoleRoutes);
  await app.register(hostnameRoutes);
  await app.register(portalRoutes);
  await app.register(editorRoutes);
  await app.register(voucherRoutes);
  await app.register(paymentRoutes);
  await app.register(notificationRoutes);
  await app.register(mailTemplateRoutes);
  await app.register(billingRoutes);
  await app.register(backupRoutes);
  await app.register(socialRoutes);
  await app.register(securityRoutes);
  await app.register(liveRoutes);
  await app.register(smsRoutes);
  await app.register(hotelRoutes);
  await app.register(marketingRoutes);
  await app.register(adRoutes);
  await app.register(guestPortalRoutes);
  await app.register(apiRoutes);

  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.method !== 'GET' || !existsSync(webDist)) {
      return reply.code(404).send({ error: t(requestLocale(req), 'errors.notFound') });
    }
    return reply.sendFile('index.html');
  });

  return app;
}
