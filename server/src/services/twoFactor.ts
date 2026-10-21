import { and, eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { db, schema } from '../db/index.js';
import type { User } from '../db/schema.js';
import { secureCookies } from '../lib/auth.js';
import { decrypt, encrypt, sha256 } from '../lib/crypto.js';
import { newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, otpauthUri, verifyTotp } from '../lib/totp.js';
import { getSettings, type SettingsValue } from './settings.js';
import { getTenantSettings } from './tenantSettings.js';

/**
 * Two-factor sign-in with an authenticator app. After the password, a user with 2FA gets
 * a short-lived signed cookie instead of a session, and trades it for a session with a code.
 */

const PENDING_COOKIE = 'cp_2fa';
const PENDING_TTL_MS = 5 * 60_000;
const ISSUER = 'RHIS Captive Portal';

// ── Policy ───────────────────────────────────────────────────────────────────

let cache: { at: number; value: SettingsValue<'security'> } | null = null;
const tenantCache = new Map<string, { at: number; level: 'off' | 'admins' | 'all' }>();
export const clearSecurityCache = () => {
  cache = null;
  tenantCache.clear();
};

async function platformPolicy() {
  if (!cache || Date.now() - cache.at > 30_000) cache = { at: Date.now(), value: await getSettings('security') };
  return cache.value;
}

const stricter = (a: 'off' | 'admins' | 'all', b: 'off' | 'admins' | 'all') => (a === 'all' || b === 'all' ? 'all' : a === 'admins' || b === 'admins' ? 'admins' : 'off');

/** Whether this user must use two-factor sign-in, by the platform's policy and their customer's own. */
export async function twoFactorRequired(user: Pick<User, 'role' | 'tenantId'>) {
  const platform = await platformPolicy();
  if (user.role === 'superadmin') return platform.requirePlatform;
  if (!user.tenantId) return false;
  let own = tenantCache.get(user.tenantId);
  if (!own || Date.now() - own.at > 30_000) {
    own = { at: Date.now(), level: (await getTenantSettings(user.tenantId, 'security')).require2fa };
    tenantCache.set(user.tenantId, own);
  }
  const level = stricter(platform.requireCustomers, own.level);
  return level === 'all' || (level === 'admins' && user.role === 'tenant_admin');
}

/** A signed-in user who still has to set up 2FA before they can use the panel. */
export async function needsTwoFactorSetup(user: User, method: 'password' | 'entra') {
  if (user.totpEnabledAt) return false;
  if (method === 'entra' && (await platformPolicy()).trustMicrosoft) return false;
  return twoFactorRequired(user);
}

// ── Pending sign-in ──────────────────────────────────────────────────────────

export function startPendingLogin(req: FastifyRequest, reply: FastifyReply, user: User) {
  reply.setCookie(PENDING_COOKIE, JSON.stringify({ u: user.id, e: Date.now() + PENDING_TTL_MS }), {
    path: '/api/auth',
    httpOnly: true,
    sameSite: 'strict',
    secure: secureCookies(req),
    signed: true,
    maxAge: PENDING_TTL_MS / 1000,
  });
}

export async function pendingLoginUser(req: FastifyRequest): Promise<User | null> {
  const raw = req.cookies[PENDING_COOKIE];
  const unsigned = raw ? req.unsignCookie(raw) : null;
  if (!unsigned?.valid || !unsigned.value) return null;
  try {
    const { u, e } = JSON.parse(unsigned.value) as { u: string; e: number };
    if (typeof u !== 'string' || !(e > Date.now())) return null;
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, u) });
    return user?.isActive && user.totpEnabledAt ? user : null;
  } catch {
    return null;
  }
}

export const clearPendingLogin = (reply: FastifyReply) => reply.clearCookie(PENDING_COOKIE, { path: '/api/auth' });

// ── Codes ────────────────────────────────────────────────────────────────────

/**
 * Checks a code from the authenticator app, or one of the recovery codes (which is used up).
 * The step of a used app code is stored, so the same code cannot be used again.
 */
export async function verifyUserCode(user: User, code: string): Promise<'totp' | 'recovery' | null> {
  if (!user.totpSecret) return null;
  const step = verifyTotp(decrypt(user.totpSecret), code, { lastStep: user.totpLastStep });
  if (step !== null) {
    // Only one request can claim this step
    const updated = await db
      .update(schema.users)
      .set({ totpLastStep: step })
      .where(and(eq(schema.users.id, user.id), sql`coalesce(${schema.users.totpLastStep}, -1) < ${step}`))
      .returning({ id: schema.users.id });
    return updated.length ? 'totp' : null;
  }
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== 8) return null;
  const hash = sha256(normalized);
  if (!user.recoveryCodes.includes(hash)) return null;
  const updated = await db
    .update(schema.users)
    .set({ recoveryCodes: sql`${schema.users.recoveryCodes} - ${hash}` })
    .where(and(eq(schema.users.id, user.id), sql`${schema.users.recoveryCodes} ? ${hash}`))
    .returning({ id: schema.users.id });
  return updated.length ? 'recovery' : null;
}

/** Starts set-up: a new secret, shown as a QR code until the user confirms it. */
export async function beginSetup(user: User) {
  const secret = newTotpSecret();
  await db.update(schema.users).set({ totpPendingSecret: encrypt(secret) }).where(eq(schema.users.id, user.id));
  const uri = otpauthUri(secret, user.email, ISSUER);
  const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { secret, uri, qrSvg };
}

const hashCodes = (codes: string[]) => codes.map((c) => sha256(normalizeRecoveryCode(c)));

/** Confirms set-up with a first code; returns the recovery codes, shown once. */
export async function finishSetup(user: User, code: string) {
  if (!user.totpPendingSecret) return null;
  const secret = decrypt(user.totpPendingSecret);
  const step = verifyTotp(secret, code);
  if (step === null) return null;
  const codes = newRecoveryCodes();
  await db
    .update(schema.users)
    .set({ totpSecret: encrypt(secret), totpPendingSecret: null, totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: hashCodes(codes) })
    .where(eq(schema.users.id, user.id));
  return codes;
}

export async function newCodes(user: User) {
  const codes = newRecoveryCodes();
  await db.update(schema.users).set({ recoveryCodes: hashCodes(codes) }).where(eq(schema.users.id, user.id));
  return codes;
}

/** Turns 2FA off (by the user, or by an admin when the phone is lost). */
export const disableTwoFactor = (userId: string) =>
  db.update(schema.users).set({ totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] }).where(eq(schema.users.id, userId));
