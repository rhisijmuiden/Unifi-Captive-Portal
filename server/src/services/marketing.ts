import { createHash } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { GuestContact, GuestSession } from '../db/schema.js';
import { randomToken } from '../lib/crypto.js';
import { AppError, badRequest } from '../lib/errors.js';
import { getTenantSettings, type TenantSettingsValue } from './tenantSettings.js';

/**
 * Guest contacts for marketing: every sign-in with an e-mail address updates one contact
 * per customer. Only contacts who ticked the opt-in go to Mailchimp or HubSpot. Guests can
 * ask for their data to be erased through the privacy page (GDPR art. 17).
 */

type Marketing = TenantSettingsValue<'marketing'>;

const MAILCHIMP = process.env.MAILCHIMP_API_URL; // e.g. http://localhost:9099/mc for tests
const HUBSPOT = process.env.HUBSPOT_API_URL ?? 'https://api.hubapi.com';

export const hashEmail = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

/** "Sam van Dijk" → first name "Sam", last name "van Dijk". */
export function splitName(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

/** Called after a guest got access: records the contact and syncs it when that is switched on. */
export async function recordContact(s: GuestSession) {
  if (!s.email) return;
  const email = s.email.trim().toLowerCase();
  const now = new Date();
  const [row] = await db
    .insert(schema.guestContacts)
    .values({ tenantId: s.tenantId, email, name: s.name, phone: s.phone, locale: s.locale, source: s.method, optIn: s.marketingOptIn, optInAt: s.marketingOptIn ? now : null })
    .onConflictDoUpdate({
      target: [schema.guestContacts.tenantId, schema.guestContacts.email],
      set: {
        name: sql`coalesce(${s.name}, ${schema.guestContacts.name})`,
        phone: sql`coalesce(${s.phone}, ${schema.guestContacts.phone})`,
        locale: s.locale,
        source: s.method,
        // Ticking the box opts in; not ticking it on a later visit does not opt out
        optIn: sql`${schema.guestContacts.optIn} or ${s.marketingOptIn}`,
        optInAt: s.marketingOptIn ? sql`coalesce(${schema.guestContacts.optInAt}, now())` : sql`${schema.guestContacts.optInAt}`,
        visits: sql`${schema.guestContacts.visits} + 1`,
        lastSeenAt: now,
        updatedAt: now,
      },
    })
    .returning();
  if (row.optIn) {
    const m = await getTenantSettings(s.tenantId, 'marketing');
    if (m.autoSync && providerReady(m)) void syncContacts(s.tenantId, [row]).catch(() => undefined);
  }
}

export const providerReady = (m: Marketing) =>
  (m.provider === 'mailchimp' && Boolean(m.mailchimpApiKey && m.mailchimpAudienceId)) || (m.provider === 'hubspot' && Boolean(m.hubspotToken));

function mailchimpBase(m: Marketing) {
  const dc = /-([a-z]+\d+)$/.exec(m.mailchimpApiKey)?.[1];
  if (!dc) throw badRequest('errors.mailchimpKey');
  return MAILCHIMP ?? `https://${dc}.api.mailchimp.com/3.0`;
}

async function call(url: string, init: { method?: string; auth: string; body?: unknown }) {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: { authorization: init.auth, 'content-type': 'application/json', accept: 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) throw new Error(String(json.detail ?? json.message ?? json.title ?? `HTTP ${res.status}`));
  return json;
}

const mcAuth = (m: Marketing) => `Basic ${Buffer.from(`any:${m.mailchimpApiKey}`).toString('base64')}`;
const md5 = (email: string) => createHash('md5').update(email.toLowerCase()).digest('hex');

async function pushContacts(m: Marketing, contacts: GuestContact[]) {
  if (m.provider === 'mailchimp') {
    const base = mailchimpBase(m);
    for (const c of contacts) {
      const { first, last } = splitName(c.name);
      await call(`${base}/lists/${encodeURIComponent(m.mailchimpAudienceId)}/members/${md5(c.email)}`, {
        method: 'PUT',
        auth: mcAuth(m),
        body: {
          email_address: c.email,
          // Never re-subscribes someone who unsubscribed in Mailchimp
          status_if_new: m.mailchimpDoubleOptIn ? 'pending' : 'subscribed',
          merge_fields: { FNAME: first, LNAME: last, ...(c.phone ? { PHONE: c.phone } : {}) },
          language: c.locale ?? undefined,
          tags: ['wifi'],
        },
      });
    }
    return;
  }
  // HubSpot: upsert by e-mail address, 100 per request
  for (let i = 0; i < contacts.length; i += 100) {
    const inputs = contacts.slice(i, i + 100).map((c) => {
      const { first, last } = splitName(c.name);
      return { idProperty: 'email', id: c.email, properties: { email: c.email, firstname: first, lastname: last, ...(c.phone ? { phone: c.phone } : {}) } };
    });
    await call(`${HUBSPOT}/crm/v3/objects/contacts/batch/upsert`, { method: 'POST', auth: `Bearer ${m.hubspotToken}`, body: { inputs } });
  }
}

/** Sends opted-in contacts to the provider and records the result on each contact. */
export async function syncContacts(tenantId: string, only?: GuestContact[]) {
  const m = await getTenantSettings(tenantId, 'marketing');
  if (!providerReady(m)) return { synced: 0, failed: 0 };
  const c = schema.guestContacts;
  const list =
    only ??
    (await db.query.guestContacts.findMany({ where: and(eq(c.tenantId, tenantId), eq(c.optIn, true), or(isNull(c.syncedAt), gt(c.updatedAt, c.syncedAt))), limit: 1000 }));
  if (!list.length) return { synced: 0, failed: 0 };
  try {
    await pushContacts(m, list);
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await db.update(c).set({ syncError: message }).where(inArray(c.id, list.map((x) => x.id)));
    if (err instanceof AppError) throw err;
    throw badRequest('errors.marketingApi', { reason: message });
  }
  await db.update(c).set({ syncedAt: new Date(), syncError: null }).where(inArray(c.id, list.map((x) => x.id)));
  return { synced: list.length, failed: 0 };
}

/** Checks the credentials: the audience (Mailchimp) or a contacts read (HubSpot). */
export async function testMarketing(m: Marketing) {
  if (!providerReady(m)) throw badRequest('errors.marketingSetup');
  try {
    if (m.provider === 'mailchimp') {
      const list = await call(`${mailchimpBase(m)}/lists/${encodeURIComponent(m.mailchimpAudienceId)}`, { auth: mcAuth(m) });
      return { ok: true, name: String(list.name ?? '') };
    }
    await call(`${HUBSPOT}/crm/v3/objects/contacts?limit=1`, { auth: `Bearer ${m.hubspotToken}` });
    return { ok: true, name: 'HubSpot' };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw badRequest('errors.marketingApi', { reason: (err as Error).message });
  }
}

async function removeAtProvider(m: Marketing, email: string) {
  if (!providerReady(m)) return;
  if (m.provider === 'mailchimp') {
    await call(`${mailchimpBase(m)}/lists/${encodeURIComponent(m.mailchimpAudienceId)}/members/${md5(email)}/actions/delete-permanent`, { method: 'POST', auth: mcAuth(m) }).catch((err) => {
      if (!/not found|404/i.test((err as Error).message)) throw err;
    });
  } else {
    await call(`${HUBSPOT}/crm/v3/objects/contacts/gdpr-delete`, { method: 'POST', auth: `Bearer ${m.hubspotToken}`, body: { objectId: email, idProperty: 'email' } }).catch((err) => {
      if (!/not found|404|does not exist/i.test((err as Error).message)) throw err;
    });
  }
}

/** Erases a guest: personal data on every visit, the contact, and the copy at the provider. */
export async function forgetEmail(tenantId: string, rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  const g = schema.guestSessions;
  const wiped = await db
    .update(g)
    .set({ name: null, email: null, phone: null, marketingOptIn: false })
    .where(and(eq(g.tenantId, tenantId), sql`lower(${g.email}) = ${email}`))
    .returning({ id: g.id });
  const contacts = await db.delete(schema.guestContacts).where(and(eq(schema.guestContacts.tenantId, tenantId), eq(schema.guestContacts.email, email))).returning({ id: schema.guestContacts.id });
  let providerError: string | null = null;
  try {
    await removeAtProvider(await getTenantSettings(tenantId, 'marketing'), email);
  } catch (err) {
    providerError = (err as Error).message;
  }
  return { sessions: wiped.length, contacts: contacts.length, providerError };
}

/** Whether we hold anything for this address, so the confirmation e-mail is only sent when useful. */
export async function knowsEmail(tenantId: string, email: string) {
  const e = email.trim().toLowerCase();
  const [hit] = await db
    .select({ n: sql<number>`1` })
    .from(schema.guestSessions)
    .where(and(eq(schema.guestSessions.tenantId, tenantId), sql`lower(${schema.guestSessions.email}) = ${e}`))
    .limit(1);
  if (hit) return true;
  return Boolean(await db.query.guestContacts.findFirst({ where: and(eq(schema.guestContacts.tenantId, tenantId), eq(schema.guestContacts.email, e)) }));
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** A new erase request; returns the token for the confirmation link. */
export async function createPrivacyRequest(tenantId: string, email: string) {
  const token = randomToken();
  await db.insert(schema.privacyRequests).values({ tenantId, email: email.trim().toLowerCase(), emailHash: hashEmail(email), tokenHash: tokenHash(token) });
  return token;
}

export const PRIVACY_LINK_HOURS = 48;

export async function findPrivacyRequest(token: string) {
  const r = await db.query.privacyRequests.findFirst({ where: eq(schema.privacyRequests.tokenHash, tokenHash(token)) });
  if (!r) return null;
  const expired = r.status === 'pending' && Date.now() - r.createdAt.getTime() > PRIVACY_LINK_HOURS * 3600_000;
  return { ...r, expired };
}

export async function completePrivacyRequest(id: string) {
  const r = await db.query.privacyRequests.findFirst({ where: eq(schema.privacyRequests.id, id) });
  if (!r || r.status !== 'pending' || !r.email) return null;
  const result = await forgetEmail(r.tenantId, r.email);
  await db.update(schema.privacyRequests).set({ status: 'done', email: null, sessions: result.sessions, doneAt: new Date() }).where(eq(schema.privacyRequests.id, id));
  return result;
}

/** An erase done by the customer's admin, logged like a guest request. */
export async function adminForget(tenantId: string, email: string) {
  const result = await forgetEmail(tenantId, email);
  await db.insert(schema.privacyRequests).values({ tenantId, email: null, emailHash: hashEmail(email), tokenHash: tokenHash(randomToken()), status: 'done', via: 'admin', sessions: result.sessions, doneAt: new Date() });
  return result;
}

export const privacyRequests = (tenantId: string) =>
  db.query.privacyRequests.findMany({ where: eq(schema.privacyRequests.tenantId, tenantId), orderBy: [desc(schema.privacyRequests.createdAt)], limit: 200, columns: { email: false, tokenHash: false } });

/**
 * Daily: personal data of guests without opt-in is removed after the customer's retention
 * period; opted-in contacts stay until they withdraw. Unconfirmed requests expire.
 */
export async function runRetention() {
  const rows = await db.select({ tenantId: schema.tenantSettings.tenantId, value: schema.tenantSettings.value }).from(schema.tenantSettings).where(eq(schema.tenantSettings.key, 'marketing'));
  for (const r of rows) {
    const days = Number((r.value as { retentionDays?: number }).retentionDays ?? 0);
    if (!days) continue;
    const before = new Date(Date.now() - days * 86_400_000);
    const g = schema.guestSessions;
    await db
      .update(g)
      .set({ name: null, email: null, phone: null })
      .where(and(eq(g.tenantId, r.tenantId), eq(g.marketingOptIn, false), lt(g.createdAt, before), sql`(${g.email} is not null or ${g.name} is not null or ${g.phone} is not null)`));
    await db.delete(schema.guestContacts).where(and(eq(schema.guestContacts.tenantId, r.tenantId), eq(schema.guestContacts.optIn, false), lt(schema.guestContacts.lastSeenAt, before)));
  }
  await db
    .update(schema.privacyRequests)
    .set({ email: null })
    .where(and(eq(schema.privacyRequests.status, 'pending'), lt(schema.privacyRequests.createdAt, new Date(Date.now() - PRIVACY_LINK_HOURS * 3600_000))));
}

/** Every 15 minutes: contacts changed since the last sync, for customers with auto-sync on. */
export async function syncAllContacts() {
  const rows = await db.select({ tenantId: schema.tenantSettings.tenantId, value: schema.tenantSettings.value }).from(schema.tenantSettings).where(eq(schema.tenantSettings.key, 'marketing'));
  for (const r of rows) {
    const v = r.value as { autoSync?: boolean; provider?: string };
    if (v.autoSync === false || !v.provider || v.provider === 'none') continue;
    await syncContacts(r.tenantId).catch((err) => console.warn(`marketing sync ${r.tenantId}: ${(err as Error).message}`));
  }
}
