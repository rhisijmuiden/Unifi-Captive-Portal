import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { ApiKey, User } from '../db/schema.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { scopeList, type Audience } from '../api/catalog.js';
import { resellerOfTenant } from './resellers.js';

/** Keys look like cpk_<43 random characters>; the first 12 characters are kept to recognise a key. */
const KEY_PREFIX = 'cpk_';
const KEY_RE = /^cpk_[A-Za-z0-9_-]{43}$/;
export const REQUEST_LOG_DAYS = 90;

export const audienceOf = (key: Pick<ApiKey, 'tenantId'>): Audience => (key.tenantId ? 'tenant' : 'platform');

export function newKey() {
  const token = `${KEY_PREFIX}${randomToken(32)}`;
  return { token, prefix: token.slice(0, 12), hash: sha256(token) };
}

/** Only scopes that exist for this kind of key are kept, without duplicates. */
export const cleanScopes = (audience: Audience, scopes: string[]) => {
  const allowed = new Set(scopeList(audience));
  return [...new Set(scopes)].filter((s) => allowed.has(s)).sort();
};

export function publicKey(k: ApiKey & { createdByName?: string | null }) {
  const { keyHash: _hash, ...rest } = k;
  const now = Date.now();
  const status = k.revokedAt ? 'revoked' : k.expiresAt && +k.expiresAt <= now ? 'expired' : 'active';
  return { ...rest, status };
}

export type KeyAuth = { ok: true; key: ApiKey; user: User } | { ok: false; reason: 'invalid' | 'expired' | 'revoked' | 'suspended' };

/** Looks up the key from an `Authorization: Bearer cpk_…` header and acts as a user of its customer (or the platform). */
export async function authenticateKey(header: string | undefined): Promise<KeyAuth> {
  const token = /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1];
  if (!token || !KEY_RE.test(token)) return { ok: false, reason: 'invalid' };
  const rows = await db
    .select({ key: schema.apiKeys, tenantStatus: schema.tenants.status, creator: schema.users })
    .from(schema.apiKeys)
    .leftJoin(schema.tenants, eq(schema.tenants.id, schema.apiKeys.tenantId))
    .leftJoin(schema.users, eq(schema.users.id, schema.apiKeys.createdBy))
    .where(eq(schema.apiKeys.keyHash, sha256(token)))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, reason: 'invalid' };
  const { key, creator } = row;
  if (key.revokedAt) return { ok: false, reason: 'revoked' };
  if (key.expiresAt && +key.expiresAt <= Date.now()) return { ok: false, reason: 'expired' };
  if (row.tenantStatus === 'suspended') return { ok: false, reason: 'suspended' };
  if (key.tenantId && (await resellerOfTenant(key.tenantId))?.status === 'suspended') return { ok: false, reason: 'suspended' };
  // The key acts as an admin of its customer, or as a platform admin; its scopes decide what it may do
  const user: User = {
    id: key.id,
    email: creator?.email ?? '',
    name: `API: ${key.name}`,
    passwordHash: null,
    role: key.tenantId ? 'tenant_admin' : 'superadmin',
    tenantId: key.tenantId,
    resellerId: null,
    isActive: true,
    entraOid: null,
    // No saved language: API errors follow Accept-Language or X-Locale
    locale: null,
    totpSecret: null,
    totpPendingSecret: null,
    totpEnabledAt: null,
    totpLastStep: null,
    recoveryCodes: [],
    lastLoginAt: null,
    createdAt: key.createdAt,
  };
  return { ok: true, key, user };
}

// ── Rate limiting: a fixed one-minute window per key, kept in memory ─────────

const windows = new Map<string, { start: number; count: number }>();

export function takeRequest(keyId: string, limit: number, now = Date.now()) {
  const minute = now - (now % 60_000);
  let w = windows.get(keyId);
  if (!w || w.start !== minute) {
    w = { start: minute, count: 0 };
    windows.set(keyId, w);
  }
  w.count++;
  // Old windows are dropped now and then, so the map does not grow forever
  if (windows.size > 10_000) for (const [k, v] of windows) if (v.start < minute) windows.delete(k);
  return { allowed: w.count <= limit, limit, remaining: Math.max(0, limit - w.count), reset: Math.ceil((minute + 60_000 - now) / 1000) };
}

/** Writes one line of the key's audit trail and its usage counters. */
export async function logRequest(key: ApiKey, entry: { method: string; path: string; status: number; durationMs: number; ip: string }) {
  await db.insert(schema.apiRequests).values({ apiKeyId: key.id, ...entry, path: entry.path.slice(0, 500) });
  await db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date(), lastUsedIp: entry.ip, requestCount: sql`${schema.apiKeys.requestCount} + 1` })
    .where(eq(schema.apiKeys.id, key.id));
}

export const purgeApiRequests = () => db.delete(schema.apiRequests).where(lt(schema.apiRequests.createdAt, new Date(Date.now() - REQUEST_LOG_DAYS * 86_400_000)));

/** Keys of one customer, or the platform's own keys (tenantId null). */
export async function listKeys(tenantId: string | null) {
  const rows = await db
    .select({ key: schema.apiKeys, createdByName: schema.users.name })
    .from(schema.apiKeys)
    .leftJoin(schema.users, eq(schema.users.id, schema.apiKeys.createdBy))
    .where(tenantId ? eq(schema.apiKeys.tenantId, tenantId) : isNull(schema.apiKeys.tenantId))
    .orderBy(desc(schema.apiKeys.createdAt));
  return rows.map((r) => publicKey({ ...r.key, createdByName: r.createdByName }));
}

export const ownKey = (id: string, tenantId: string | null) =>
  db.query.apiKeys.findFirst({ where: and(eq(schema.apiKeys.id, id), tenantId ? eq(schema.apiKeys.tenantId, tenantId) : isNull(schema.apiKeys.tenantId)) });
