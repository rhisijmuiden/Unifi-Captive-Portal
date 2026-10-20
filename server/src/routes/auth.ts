import { count, eq, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit, createSession, destroySession, publicUser, requireUser, secureCookies } from '../lib/auth.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { buildEntraLogin, completeEntraLogin, entraConfig } from '../services/entra.js';
import { getSettings } from '../services/settings.js';
import { consumeToken, sendPasswordReset } from '../services/tokens.js';
import { config } from '../config.js';
import { isLocale, requestLocale } from '../i18n/index.js';

const password = z.string().min(10, 'errors.passwordTooShort').max(200);
const FLOW_COOKIE = 'cp_entra_flow';
const loginLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/state', async (req) => {
    const [{ value: userCount }] = await db.select({ value: count() }).from(schema.users);
    const sso = await getSettings('sso');
    const smtp = await getSettings('smtp');
    return {
      needsSetup: userCount === 0,
      user: req.user ? publicUser(req.user) : null,
      sso: { entraEnabled: sso.entraEnabled, buttonLabel: sso.buttonLabel, allowLocalLogin: sso.allowLocalLogin || !sso.entraEnabled },
      passwordResetAvailable: smtp.enabled,
      version: config.version,
    };
  });

  // First-run wizard: creates the first superadmin, only while no users exist
  app.post('/api/auth/setup', loginLimit, async (req, reply) => {
    const body = z.object({ name: z.string().min(1), email: z.string().email(), password }).parse(req.body);
    const user = await db.transaction(async (tx) => {
      await tx.execute(sql`lock table users in exclusive mode`);
      const [{ value }] = await tx.select({ value: count() }).from(schema.users);
      if (value > 0) throw badRequest('errors.setupDone');
      const [created] = await tx
        .insert(schema.users)
        .values({ name: body.name, email: body.email.toLowerCase(), passwordHash: await hashPassword(body.password), role: 'superadmin', locale: requestLocale(req) })
        .returning();
      return created;
    });
    await createSession(req, reply, user);
    req.user = user;
    await audit(req, 'setup.completed');
    return { user: publicUser(user) };
  });

  app.post('/api/auth/login', loginLimit, async (req, reply) => {
    const body = z.object({ email: z.string(), password: z.string() }).parse(req.body);
    const sso = await getSettings('sso');
    const user = await db.query.users.findFirst({ where: eq(schema.users.email, body.email.toLowerCase().trim()) });
    const ok = user?.passwordHash ? await verifyPassword(user.passwordHash, body.password) : false;
    if (!user || !ok || !user.isActive) throw unauthorized('errors.badCredentials');
    if (sso.entraEnabled && !sso.allowLocalLogin && user.role !== 'superadmin') {
      throw unauthorized('errors.useMicrosoft');
    }
    if (user.tenantId) {
      const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, user.tenantId) });
      if (tenant?.status === 'suspended') throw unauthorized('errors.tenantSuspended');
    }
    await createSession(req, reply, user);
    req.user = user;
    await audit(req, 'auth.login', { method: 'password' });
    return { user: publicUser(user) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: publicUser(requireUser(req)) }));

  app.put('/api/auth/locale', async (req) => {
    const user = requireUser(req);
    const { locale } = z.object({ locale: z.string().refine(isLocale) }).parse(req.body);
    await db.update(schema.users).set({ locale }).where(eq(schema.users.id, user.id));
    return { ok: true, locale };
  });

  app.post('/api/auth/password', async (req) => {
    const user = requireUser(req);
    const body = z.object({ current: z.string().optional(), password }).parse(req.body);
    if (user.passwordHash && !(await verifyPassword(user.passwordHash, body.current ?? ''))) {
      throw badRequest('errors.wrongPassword');
    }
    await db.update(schema.users).set({ passwordHash: await hashPassword(body.password) }).where(eq(schema.users.id, user.id));
    await audit(req, 'auth.password_changed');
    return { ok: true };
  });

  app.post('/api/auth/forgot', loginLimit, async (req) => {
    const body = z.object({ email: z.string().email() }).parse(req.body);
    const user = await db.query.users.findFirst({ where: eq(schema.users.email, body.email.toLowerCase()) });
    // Always answer the same, so the form cannot be used to probe for accounts
    if (user?.isActive) await sendPasswordReset(user).catch((err) => req.log.error(err, 'password reset mail failed'));
    return { ok: true };
  });

  app.post('/api/auth/reset', loginLimit, async (req, reply) => {
    const body = z.object({ token: z.string().min(10), password }).parse(req.body);
    const user = await consumeToken(body.token);
    if (!user || !user.isActive) throw badRequest('errors.linkInvalid');
    await db.update(schema.users).set({ passwordHash: await hashPassword(body.password) }).where(eq(schema.users.id, user.id));
    await createSession(req, reply, user);
    req.user = user;
    await audit(req, 'auth.password_reset');
    return { user: publicUser(user) };
  });

  app.get('/api/auth/entra/start', async (_req, reply) => {
    const cfg = await entraConfig();
    if (!cfg) return reply.redirect('/login?error=sso_disabled');
    const { url, flow } = await buildEntraLogin(cfg);
    reply.setCookie(FLOW_COOKIE, JSON.stringify(flow), {
      path: '/api/auth/entra',
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      signed: true,
      maxAge: 600,
    });
    return reply.redirect(url);
  });

  app.get('/api/auth/entra/callback', async (req, reply) => {
    const cfg = await entraConfig();
    const raw = req.cookies[FLOW_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    reply.clearCookie(FLOW_COOKIE, { path: '/api/auth/entra' });
    if (!cfg || !unsigned?.valid || !unsigned.value) return reply.redirect('/login?error=sso_failed');
    try {
      const callbackUrl = new URL(req.url, config.publicUrl);
      const identity = await completeEntraLogin(cfg, callbackUrl, JSON.parse(unsigned.value));
      const user = await db.query.users.findFirst({
        where: or(eq(schema.users.entraOid, identity.oid), eq(schema.users.email, identity.email)),
      });
      if (!user || !user.isActive) {
        req.log.warn({ email: identity.email }, 'SSO login for unknown user');
        return reply.redirect('/login?error=sso_unknown');
      }
      if (user.entraOid && user.entraOid !== identity.oid) return reply.redirect('/login?error=sso_mismatch');
      if (!user.entraOid) await db.update(schema.users).set({ entraOid: identity.oid }).where(eq(schema.users.id, user.id));
      await createSession(req, reply, user);
      req.user = user;
      await audit(req, 'auth.login', { method: 'entra' });
      return reply.redirect('/');
    } catch (err) {
      req.log.error(err, 'Entra callback failed');
      return reply.redirect('/login?error=sso_failed');
    }
  });
}
