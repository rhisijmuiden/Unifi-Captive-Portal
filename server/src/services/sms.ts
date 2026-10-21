import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { GuestSession } from '../db/schema.js';
import { badRequest } from '../lib/errors.js';
import { getTenantSettings, type TenantSettingsValue } from './tenantSettings.js';

/**
 * SMS login: the guest types a mobile number, gets a six-digit code and types it back.
 * Sent with the customer's own Twilio or MessageBird account. Limits per guest page,
 * per number and per customer per day keep abuse (and the customer's bill) small.
 */

type Sms = TenantSettingsValue<'sms'>;

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const RESEND_AFTER_MS = 30_000;
export const MAX_SENDS_PER_SESSION = 3;
export const MAX_SENDS_PER_PHONE_HOUR = 5;

const TWILIO = process.env.TWILIO_API_URL ?? 'https://api.twilio.com';
const MESSAGEBIRD = process.env.MESSAGEBIRD_API_URL ?? 'https://rest.messagebird.com';

export const smsConfigured = (s: Sms) =>
  (s.provider === 'twilio' && Boolean(s.twilioAccountSid && s.twilioAuthToken && s.twilioFrom)) ||
  (s.provider === 'messagebird' && Boolean(s.messagebirdApiKey && s.messagebirdOriginator));

/**
 * A typed number as E.164 (+31612345678), or null. Accepts spaces, dashes, dots and
 * brackets, "00" for "+", and a leading 0 for a number in the default country.
 */
export function normalizePhone(input: string, defaultCountry: string): string | null {
  let n = input.trim().replace(/[\s().\-/]/g, '');
  if (n.startsWith('00')) n = `+${n.slice(2)}`;
  else if (/^0\d/.test(n)) n = `+${defaultCountry}${n.slice(1)}`;
  else if (/^\d/.test(n)) n = `+${n}`;
  // Remove the national trunk zero people often keep: +31 (0)6 …
  n = n.replace(/^\+(\d{1,3})0(?=\d{8,})/, (m, cc: string) => (cc === defaultCountry ? `+${cc}` : m));
  return /^\+[1-9]\d{7,14}$/.test(n) ? n : null;
}

/** "+31 •••• 5678": enough for the guest to recognise their number on screen. */
export const maskPhone = (e164: string) => `${e164.slice(0, 3)}\u00a0••••\u00a0${e164.slice(-4)}`;

const hashCode = (sessionId: string, code: string) => createHash('sha256').update(`${sessionId}:${code}`).digest('hex');

async function twilio(s: Sms, to: string, body: string) {
  const form = new URLSearchParams({ To: to, Body: body });
  form.set(/^MG[0-9a-f]{32}$/i.test(s.twilioFrom) ? 'MessagingServiceSid' : 'From', s.twilioFrom);
  const res = await fetch(`${TWILIO}/2010-04-01/Accounts/${encodeURIComponent(s.twilioAccountSid)}/Messages.json`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${s.twilioAccountSid}:${s.twilioAuthToken}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string; sid?: string };
  if (!res.ok) throw new Error(json.message ?? `HTTP ${res.status}`);
  return json.sid ?? '';
}

async function messagebird(s: Sms, to: string, body: string) {
  const res = await fetch(`${MESSAGEBIRD}/messages`, {
    method: 'POST',
    headers: { authorization: `AccessKey ${s.messagebirdApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ originator: s.messagebirdOriginator, recipients: [to.slice(1)], body }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; errors?: { description?: string }[] };
  if (!res.ok) throw new Error(json.errors?.[0]?.description ?? `HTTP ${res.status}`);
  return json.id ?? '';
}

export async function sendSms(s: Sms, to: string, body: string) {
  if (s.provider === 'twilio') return twilio(s, to, body);
  if (s.provider === 'messagebird') return messagebird(s, to, body);
  throw new Error('No SMS provider');
}

/** Admin test: sends one message with the form's (or stored) credentials. */
export async function testSms(s: Sms, to: string) {
  if (!smsConfigured(s)) throw badRequest('errors.smsSetup');
  const phone = normalizePhone(to, s.defaultCountry);
  if (!phone) throw badRequest('errors.phoneInvalid');
  try {
    await sendSms(s, phone, 'Test message from the guest portal: SMS login works.');
    return { ok: true, phone };
  } catch (err) {
    throw badRequest('errors.smsApi', { reason: (err as Error).message });
  }
}

export type SendResult = { ok: true; phone: string; canResend: boolean } | { ok: false; reason: 'phoneInvalid' | 'smsTooMany' | 'smsWait' | 'smsUnavailable' };

const count = async (where: ReturnType<typeof and>) => {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.guestVerifications).where(where);
  return r?.n ?? 0;
};

/** Sends a new code to the guest, within the limits. `text` holds {{code}}. */
export async function sendGuestCode(session: GuestSession, rawPhone: string, text: string): Promise<SendResult> {
  const s = await getTenantSettings(session.tenantId, 'sms');
  if (!smsConfigured(s)) return { ok: false, reason: 'smsUnavailable' };
  const phone = normalizePhone(rawPhone, s.defaultCountry);
  if (!phone) return { ok: false, reason: 'phoneInvalid' };
  const now = Date.now();
  const v = schema.guestVerifications;
  const last = await db.query.guestVerifications.findFirst({ where: eq(v.guestSessionId, session.id), orderBy: [desc(v.createdAt)] });
  if (last && now - last.createdAt.getTime() < RESEND_AFTER_MS) return { ok: false, reason: 'smsWait' };
  const [bySession, byPhone, byTenant] = await Promise.all([
    count(and(eq(v.guestSessionId, session.id))),
    count(and(eq(v.phone, phone), gt(v.createdAt, new Date(now - 3600_000)))),
    count(and(eq(v.tenantId, session.tenantId), gt(v.createdAt, new Date(now - 86_400_000)))),
  ]);
  if (bySession >= MAX_SENDS_PER_SESSION || byPhone >= MAX_SENDS_PER_PHONE_HOUR || byTenant >= s.dailyLimit) return { ok: false, reason: 'smsTooMany' };
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  // Recorded before sending, so a slow or failing provider still counts towards the limits
  const [row] = await db
    .insert(v)
    .values({ tenantId: session.tenantId, guestSessionId: session.id, phone, codeHash: hashCode(session.id, code), provider: s.provider, expiresAt: new Date(now + CODE_TTL_MS) })
    .returning();
  try {
    await sendSms(s, phone, text.replace('{{code}}', code));
  } catch (err) {
    await db.update(v).set({ expiresAt: new Date(now) }).where(eq(v.id, row.id));
    throw err;
  }
  return { ok: true, phone, canResend: bySession + 1 < MAX_SENDS_PER_SESSION };
}

export type VerifyResult = { ok: true; phone: string } | { ok: false; reason: 'smsCodeInvalid' | 'smsCodeExpired' };

/** Checks the code against the latest one sent for this guest page. */
export async function verifyGuestCode(session: GuestSession, code: string): Promise<VerifyResult> {
  const v = schema.guestVerifications;
  const last = await db.query.guestVerifications.findFirst({ where: and(eq(v.guestSessionId, session.id), isNull(v.verifiedAt)), orderBy: [desc(v.createdAt)] });
  if (!last || last.expiresAt.getTime() < Date.now() || last.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'smsCodeExpired' };
  // Counted first, so parallel guesses cannot get past the limit
  const [counted] = await db
    .update(v)
    .set({ attempts: sql`${v.attempts} + 1` })
    .where(and(eq(v.id, last.id), sql`${v.attempts} < ${MAX_ATTEMPTS}`))
    .returning();
  if (!counted) return { ok: false, reason: 'smsCodeExpired' };
  const given = Buffer.from(hashCode(session.id, code.replace(/\D/g, '')));
  if (!timingSafeEqual(given, Buffer.from(last.codeHash))) return { ok: false, reason: counted.attempts >= MAX_ATTEMPTS ? 'smsCodeExpired' : 'smsCodeInvalid' };
  await db.update(v).set({ verifiedAt: new Date() }).where(eq(v.id, last.id));
  return { ok: true, phone: last.phone };
}

/** The pending code for a guest page, to show the code form again after a reload. */
export async function pendingCode(sessionId: string) {
  const v = schema.guestVerifications;
  const last = await db.query.guestVerifications.findFirst({ where: and(eq(v.guestSessionId, sessionId), isNull(v.verifiedAt)), orderBy: [desc(v.createdAt)] });
  if (!last || last.expiresAt.getTime() < Date.now() || last.attempts >= MAX_ATTEMPTS) return null;
  const sends = await count(and(eq(v.guestSessionId, sessionId)));
  return { phone: last.phone, canResend: sends < MAX_SENDS_PER_SESSION };
}

/** Texts sent this month, for the settings page. */
export async function smsUsage(tenantId: string) {
  const v = schema.guestVerifications;
  const [r] = await db
    .select({ month: sql<number>`count(*) filter (where ${v.createdAt} >= date_trunc('month', now()))::int`, today: sql<number>`count(*) filter (where ${v.createdAt} > now() - interval '1 day')::int` })
    .from(v)
    .where(eq(v.tenantId, tenantId));
  return { month: r?.month ?? 0, last24h: r?.today ?? 0 };
}

/** Codes are kept 30 days for the limits and usage figures, then removed. */
export const purgeOldCodes = () => db.delete(schema.guestVerifications).where(lt(schema.guestVerifications.createdAt, new Date(Date.now() - 30 * 86_400_000)));
