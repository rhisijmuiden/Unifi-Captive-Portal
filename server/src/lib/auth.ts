import { and, eq, gt, lt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import type { ApiKey, User } from '../db/schema.js';
import { randomToken, sha256 } from './crypto.js';
import { forbidden, unauthorized } from './errors.js';

export const SESSION_COOKIE = 'cp_session';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
/** Cookies are marked Secure whenever the browser reached us over HTTPS (directly or through Caddy). */
export const secureCookies = (req: FastifyRequest) => req.protocol === 'https' || config.publicUrl.startsWith('https://');

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    /** Set when the request came in through /api/v1 with an API key; req.user then acts for that key */
    apiKey: ApiKey | null;
    /** How the session's user signed in */
    sessionMethod: 'password' | 'entra' | null;
  }
}

export async function createSession(req: FastifyRequest, reply: FastifyReply, user: User, method: 'password' | 'entra' = 'password') {
  const token = randomToken();
  await db.insert(schema.sessions).values({
    id: sha256(token),
    userId: user.id,
    method,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 300),
  });
  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(req),
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function loadUser(req: FastifyRequest): Promise<User | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const rows = await db
    .select({ user: schema.users, tenantStatus: schema.tenants.status, method: schema.sessions.method })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .leftJoin(schema.tenants, eq(schema.tenants.id, schema.users.tenantId))
    .where(and(eq(schema.sessions.id, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row || !row.user.isActive || row.tenantStatus === 'suspended') return null;
  req.sessionMethod = row.method;
  return row.user;
}

export const purgeExpiredSessions = () => db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));

export function requireUser(req: FastifyRequest): User {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireSuperadmin(req: FastifyRequest): User {
  const user = requireUser(req);
  if (user.role !== 'superadmin') throw forbidden();
  return user;
}

/** Superadmins may act on any tenant; tenant admins only on their own. */
export function requireTenantAdmin(req: FastifyRequest, tenantId?: string | null): User {
  const user = requireUser(req);
  if (user.role === 'superadmin') return user;
  if (user.role !== 'tenant_admin' || (tenantId !== undefined && tenantId !== user.tenantId)) throw forbidden();
  return user;
}

export function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    tenantId: u.tenantId,
    isActive: u.isActive,
    hasPassword: Boolean(u.passwordHash),
    ssoLinked: Boolean(u.entraOid),
    twoFactorEnabled: Boolean(u.totpEnabledAt),
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    locale: u.locale,
  };
}

export async function audit(req: FastifyRequest, action: string, details?: Record<string, unknown>, tenantId?: string | null) {
  await db.insert(schema.auditLog).values({
    userId: req.apiKey ? null : (req.user?.id ?? null),
    apiKeyId: req.apiKey?.id ?? null,
    tenantId: tenantId ?? req.user?.tenantId ?? null,
    action,
    details: details ?? null,
    ip: req.ip,
  });
}

/**
 * The tenant a request acts on. Consoles, portals, hostnames and guests belong to the
 * customer's own environment, so only customer users get here; the platform admin
 * manages customers, not their portals. With `manage`, staff members (read-only) are refused.
 */
export function tenantScope(req: FastifyRequest, manage = false): string {
  const user = requireUser(req);
  if (user.role === 'superadmin' || !user.tenantId) throw forbidden();
  if (manage && user.role !== 'tenant_admin') throw forbidden();
  return user.tenantId;
}
