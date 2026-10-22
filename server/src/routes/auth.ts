import { and, count, eq, gt, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { accountSuspended, audit, createSession, destroySession, passwordChangeRequired, publicUser, requireUser, secureCookies } from '../lib/auth.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { buildEntraLogin, completeEntraLogin, entraConfig } from '../services/entra.js';
import { adminBaseUrl, getSettings } from '../services/settings.js';
import { brandFor, resellerForHost } from '../services/resellers.js';
import {
  beginSetup,
  clearPendingLogin,
  disableTwoFactor,
  finishSetup,
  needsTwoFactorSetup,
  newCodes,
  pendingLoginUser,
  startPendingLogin,
  twoFactorRequired,
  verifyUserCode,
} from '../services/twoFactor.js';
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
      passwordChangeRequired: req.user ? passwordChangeRequired(req.user, req.sessionMethod ?? 'password') : false,
      twoFactorSetupRequired: req.user ? await needsTwoFactorSetup(req.user, req.sessionMethod ?? 'password') : false,
      twoFactorPending: !req.user && Boolean(await pendingLoginUser(req)),
      sso: { entraEnabled: sso.entraEnabled, buttonLabel: sso.buttonLabel, allowLocalLogin: sso.allowLocalLogin || !sso.entraEnabled },
      passwordResetAvailable: smtp.enabled,
      version: config.version,
      // A reseller's own brand, by the signed-in user or the address the panel is opened on
      brand: await brandFor(req.user, req.hostname),
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
    const suspended = await accountSuspended(user);
    if (suspended) throw unauthorized(suspended);
    // With two-factor sign-in, the session only comes after the code
    if (user.totpEnabledAt) {
      startPendingLogin(req, reply, user);
      return { twoFactor: true };
    }
    await createSession(req, reply, user);
    req.user = user;
    await audit(req, 'auth.login', { method: 'password' });
    return { user: publicUser(user) };
  });

  app.post('/api/auth/login/verify', loginLimit, async (req, reply) => {
    const { code } = z.object({ code: z.string().trim().min(6).max(20) }).parse(req.body);
    const user = await pendingLoginUser(req);
    if (!user) throw unauthorized('errors.twoFactorExpired');
    // Guessing codes is slowed down per account, not only per address
    const [{ value: recentFailures }] = await db
      .select({ value: count() })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.userId, user.id), eq(schema.auditLog.action, 'auth.2fa_failed'), gt(schema.auditLog.createdAt, new Date(Date.now() - 15 * 60_000))));
    if (recentFailures >= 8) throw unauthorized('errors.twoFactorLocked');
    const used = await verifyUserCode(user, code);
    if (!used) {
      await db.insert(schema.auditLog).values({ userId: user.id, tenantId: user.tenantId, action: 'auth.2fa_failed', ip: req.ip });
      throw unauthorized('errors.twoFactorCode');
    }
    clearPendingLogin(reply);
    const suspended = await accountSuspended(user);
    if (suspended) throw unauthorized(suspended);
    await createSession(req, reply, user);
    req.user = user;
    await audit(req, 'auth.login', { method: 'password', twoFactor: used });
    return { user: publicUser(user), recoveryCodesLeft: used === 'recovery' ? (await db.query.users.findFirst({ where: eq(schema.users.id, user.id) }))!.recoveryCodes.length : null };
  });

  app.post('/api/auth/login/cancel', async (_req, reply) => {
    clearPendingLogin(reply);
    return { ok: true };
  });

  // ── Two-factor set-up on the user's own account ──
  app.post('/api/auth/2fa/setup', async (req) => {
    const user = requireUser(req);
    if (user.totpEnabledAt) throw badRequest('errors.twoFactorActive');
    return beginSetup(user);
  });

  app.post('/api/auth/2fa/enable', async (req) => {
    const user = requireUser(req);
    const { code } = z.object({ code: z.string().trim().min(6).max(10) }).parse(req.body);
    const codes = await finishSetup(user, code);
    if (!codes) throw badRequest('errors.twoFactorCode');
    await audit(req, 'auth.2fa_enabled');
    return { recoveryCodes: codes };
  });

  app.post('/api/auth/2fa/disable', async (req) => {
    const user = requireUser(req);
    const { code } = z.object({ code: z.string().trim().min(6).max(20) }).parse(req.body);
    if (await twoFactorRequired(user)) throw badRequest('errors.twoFactorRequiredPolicy');
    if (!(await verifyUserCode(user, code))) throw badRequest('errors.twoFactorCode');
    await disableTwoFactor(user.id);
    await audit(req, 'auth.2fa_disabled');
    return { ok: true };
  });

  app.post('/api/auth/2fa/recovery-codes', async (req) => {
    const user = requireUser(req);
    const { code } = z.object({ code: z.string().trim().min(6).max(20) }).parse(req.body);
    if (!(await verifyUserCode(user, code))) throw badRequest('errors.twoFactorCode');
    await audit(req, 'auth.2fa_codes_renewed');
    return { recoveryCodes: await newCodes(user) };
  });

  app.get('/api/auth/2fa', async (req) => {
    const user = requireUser(req);
    return { enabled: Boolean(user.totpEnabledAt), enabledAt: user.totpEnabledAt, recoveryCodesLeft: user.recoveryCodes.length, required: await twoFactorRequired(user) };
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
    // Right after signing in with a generated password, that password does not need to be typed again
    const forced = passwordChangeRequired(user, req.sessionMethod ?? 'password');
    if (user.passwordHash && !forced && !(await verifyPassword(user.passwordHash, body.current ?? ''))) {
      throw badRequest('errors.wrongPassword');
    }
    if (user.passwordHash && (await verifyPassword(user.passwordHash, body.password))) throw badRequest('errors.samePassword');
    await db.update(schema.users).set({ passwordHash: await hashPassword(body.password), mustChangePassword: false }).where(eq(schema.users.id, user.id));
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
    await db.update(schema.users).set({ passwordHash: await hashPassword(body.password), mustChangePassword: false }).where(eq(schema.users.id, user.id));
    // A reset link proves the mailbox, not the phone: with 2FA the code is still needed
    if (user.totpEnabledAt) {
      req.user = user;
      await audit(req, 'auth.password_reset');
      req.user = null;
      startPendingLogin(req, reply, user);
      return { twoFactor: true };
    }
    // The new password is kept, but a suspended account does not get a session
    const suspended = await accountSuspended(user);
    if (suspended) throw unauthorized(suspended);
    await createSession(req, reply, user);
    req.user = user;
    await audit(req, 'auth.password_reset');
    return { user: publicUser(user) };
  });

  app.get('/api/auth/entra/start', async (_req, reply) => {
    const cfg = await entraConfig();
    if (!cfg) return reply.redirect('/login?error=sso_disabled');
    // Microsoft returns to the platform's own address, so the sign-in starts there (e.g. from a reseller's address)
    const base = new URL(await adminBaseUrl());
    if (_req.hostname.replace(/:\d+$/, '') !== base.hostname && (await resellerForHost(_req.hostname))) return reply.redirect(new URL('/api/auth/entra/start', base).toString());
    const { url, flow } = await buildEntraLogin(cfg);
    reply.setCookie(FLOW_COOKIE, JSON.stringify(flow), {
      path: '/api/auth/entra',
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies(_req),
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
      const callbackUrl = new URL(req.url, await adminBaseUrl());
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
      if (await accountSuspended(user)) return reply.redirect('/login?error=sso_suspended');
      await createSession(req, reply, user, 'entra');
      req.user = user;
      await audit(req, 'auth.login', { method: 'entra' });
      return reply.redirect('/');
    } catch (err) {
      req.log.error(err, 'Entra callback failed');
      return reply.redirect('/login?error=sso_failed');
    }
  });
}
