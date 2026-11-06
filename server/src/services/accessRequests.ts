import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { AccessRequest, AccessRequestStatus, GuestSession, PortalAuth } from '../db/schema.js';
import { DEFAULT_LOCALE, normalizeLocale, t, type Locale } from '../i18n/index.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { authorizeSession } from './guests.js';
import { renderTemplate } from './mailTemplates.js';
import { sendMail } from './mailer.js';
import { dataRows, formatDateTime } from './notifications.js';
import { getSettings } from './settings.js';
import { normalizeMac } from './unifi.js';

/**
 * "Ask for access": a guest asks to be let onto the network, every approver gets an e-mail
 * with their own link, and the first decision counts. Approved connects the device (and, when
 * the customer wants, lets it in by itself on later visits); rejected keeps the device off the
 * portal, whatever way of connecting it tries, until an admin unblocks it.
 */

/** A request nobody decided on within this time expires; the guest can ask again. */
export const REQUEST_HOURS = 24;
export const MAX_APPROVERS = 20;

export type AccessView = AccessRequestStatus | 'expired';

export const isExpiredRequest = (r: Pick<AccessRequest, 'status' | 'createdAt'>, now = Date.now()) =>
  r.status === 'pending' && now - r.createdAt.getTime() > REQUEST_HOURS * 3600_000;

/** The status as people see it: an undecided request past its time is "expired". */
export const viewStatus = (r: Pick<AccessRequest, 'status' | 'createdAt'>, now = Date.now()): AccessView => (isExpiredRequest(r, now) ? 'expired' : r.status);

/** Approver addresses as typed in the settings: trimmed, lower case, without duplicates. */
export function cleanApprovers(list: string[]) {
  return [...new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, MAX_APPROVERS);
}

/** "Ask for access" can only be offered with someone to ask and a way to e-mail them. */
export async function approvalReady(auth: Pick<PortalAuth, 'approvers'>) {
  if (!auth.approvers?.length) return false;
  return (await getSettings('smtp')).enabled;
}

/** The request that decides what happens to a device now: its latest one. */
export async function latestForDevice(tenantId: string, clientMac: string) {
  return (
    (await db.query.accessRequests.findFirst({
      where: and(eq(schema.accessRequests.tenantId, tenantId), eq(schema.accessRequests.clientMac, normalizeMac(clientMac))),
      orderBy: [desc(schema.accessRequests.createdAt)],
    })) ?? null
  );
}

/**
 * What the portal does with a device:
 * - blocked: a rejection stands, no way of connecting is offered
 * - waiting: a request is open, the guest sees the waiting page
 * - approved: an approval that still lets the device in (remembered, or for this very visit)
 */
export type DeviceGate = { kind: 'blocked' | 'waiting' | 'approved'; request: AccessRequest } | { kind: 'open' };

export function gateFor(latest: AccessRequest | null, session: Pick<GuestSession, 'id'>, remember: boolean, now = Date.now()): DeviceGate {
  if (!latest) return { kind: 'open' };
  const status = viewStatus(latest, now);
  if (status === 'rejected') return { kind: 'blocked', request: latest };
  if (status === 'pending') return { kind: 'waiting', request: latest };
  if (status === 'approved' && (remember || latest.guestSessionId === session.id)) return { kind: 'approved', request: latest };
  return { kind: 'open' };
}

export async function deviceGate(session: GuestSession, auth: Pick<PortalAuth, 'approvalRemember'>) {
  const gate = gateFor(await latestForDevice(session.tenantId, session.clientMac), session, auth.approvalRemember);
  // The device came back on a new visit while waiting: the approval should connect this visit
  if (gate.kind === 'waiting' && gate.request.guestSessionId !== session.id) {
    await db.update(schema.accessRequests).set({ guestSessionId: session.id }).where(eq(schema.accessRequests.id, gate.request.id));
    gate.request.guestSessionId = session.id;
  }
  return gate;
}

/** Removes a request whose e-mails could not be sent, so the guest can try again. */
export const dropRequest = (id: string) => db.delete(schema.accessRequests).where(and(eq(schema.accessRequests.id, id), eq(schema.accessRequests.status, 'pending')));

/** Stores the request with a fresh link per approver; the tokens only exist in the e-mails. */
export async function createAccessRequest(input: { session: GuestSession; approvers: string[]; name: string; email: string | null; message: string | null; locale: Locale }) {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .insert(schema.accessRequests)
      .values({
        tenantId: input.session.tenantId,
        guestSessionId: input.session.id,
        clientMac: normalizeMac(input.session.clientMac),
        ssid: input.session.ssid,
        name: input.name,
        email: input.email,
        message: input.message,
        locale: input.locale,
      })
      .returning();
    const links = cleanApprovers(input.approvers).map((approver) => ({ approver, token: randomToken() }));
    if (links.length) await tx.insert(schema.accessRequestLinks).values(links.map((l) => ({ requestId: request.id, approver: l.approver, tokenHash: sha256(l.token) })));
    return { request, links };
  });
}

/** An approver who also has an account here reads the e-mail in their own language. */
async function approverLocales(tenantId: string, emails: string[], fallback: Locale) {
  const users = emails.length
    ? await db.query.users.findMany({ where: and(eq(schema.users.tenantId, tenantId), inArray(sql`lower(${schema.users.email})`, emails)), columns: { email: true, locale: true } })
    : [];
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), normalizeLocale(u.locale) ?? fallback]));
  return (email: string) => byEmail.get(email) ?? fallback;
}

export function requestMailData(locale: Locale, r: Pick<AccessRequest, 'name' | 'email' | 'message' | 'ssid' | 'clientMac' | 'createdAt'>, networkName: string, actionUrl: string) {
  const m = (k: string) => t(locale, `mail.${k}` as Parameters<typeof t>[1]);
  const vars = {
    name: r.name || r.clientMac,
    email: r.email ?? '',
    message: r.message ?? '',
    networkName,
    ssid: r.ssid ?? '',
    device: r.clientMac,
    date: formatDateTime(locale, r.createdAt),
    actionUrl,
  };
  const rows: [string, string][] = [
    [m('accessRequestName'), vars.name],
    ...(vars.email ? [[m('accessRequestEmail'), vars.email] as [string, string]] : []),
    ...(vars.message ? [[m('accessRequestMessage'), vars.message] as [string, string]] : []),
    ...(vars.ssid ? [[m('accessRequestNetwork'), vars.ssid] as [string, string]] : []),
    [m('accessRequestDevice'), vars.device],
    [m('accessRequestDate'), vars.date],
  ];
  return { vars, ...dataRows(rows) };
}

/**
 * E-mails every approver their own link. Returns how many e-mails went out; the guest is
 * only told the request was sent when at least one did.
 */
export async function sendAccessRequestMails(request: AccessRequest, links: { approver: string; token: string }[], opts: { origin: string; fallbackLocale: Locale }) {
  const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, request.tenantId), columns: { name: true } });
  const localeOf = await approverLocales(request.tenantId, links.map((l) => l.approver), opts.fallbackLocale);
  const results = await Promise.all(
    links.map(async (link) => {
      const locale = localeOf(link.approver);
      try {
        const data = requestMailData(locale, request, tenant?.name ?? '', `${opts.origin}/portal/approval/${link.token}`);
        const { subject, html, text } = await renderTemplate('accessRequest', locale, request.tenantId, data);
        await sendMail(link.approver, subject, { html, text });
        return true;
      } catch (err) {
        console.error(`access request mail to ${link.approver} failed:`, (err as Error).message);
        return false;
      }
    }),
  );
  return results.filter(Boolean).length;
}

/** The request and the approver behind an e-mailed link. */
export async function findByToken(token: string) {
  const [hit] = await db
    .select({ request: schema.accessRequests, approver: schema.accessRequestLinks.approver })
    .from(schema.accessRequestLinks)
    .innerJoin(schema.accessRequests, eq(schema.accessRequests.id, schema.accessRequestLinks.requestId))
    .where(eq(schema.accessRequestLinks.tokenHash, sha256(token)))
    .limit(1);
  return hit ?? null;
}

/**
 * Records a decision on an undecided request. The status check in the update makes the first
 * decision win when two approvers click at the same time; the loser gets null.
 */
export async function decide(id: string, decision: 'approved' | 'rejected', by: string, opts: { allowExpired?: boolean } = {}) {
  const r = schema.accessRequests;
  const fresh = opts.allowExpired ? sql`true` : sql`${r.createdAt} > now() - make_interval(hours => ${REQUEST_HOURS})`;
  const [updated] = await db
    .update(r)
    .set({ status: decision, decidedBy: by, decidedAt: new Date() })
    .where(and(eq(r.id, id), eq(r.status, 'pending'), fresh))
    .returning();
  return updated ?? null;
}

/** Ends an approval (the device asks again next time) or lifts a rejection (the device may connect again). */
export async function clearDecision(tenantId: string, id: string, by: string) {
  const r = schema.accessRequests;
  const row = await db.query.accessRequests.findFirst({ where: and(eq(r.id, id), eq(r.tenantId, tenantId)) });
  if (!row || (row.status !== 'approved' && row.status !== 'rejected')) return null;
  const [updated] = await db
    .update(r)
    .set({ status: row.status === 'approved' ? 'revoked' : 'unblocked', decidedBy: by, decidedAt: new Date() })
    .where(and(eq(r.id, id), eq(r.status, row.status)))
    .returning();
  return updated ?? null;
}

/**
 * Lets an approved device through on the visit it asked on. Quietly does nothing when that
 * visit is gone or already connected; a device that left the network is connected when the
 * guest's page checks back, or on its next visit when approvals are remembered.
 */
export async function grantRequestedVisit(request: AccessRequest, opts: { retries?: number } = {}) {
  if (!request.guestSessionId) return { ok: false as const, error: 'visit no longer exists' };
  const session = await db.query.guestSessions.findFirst({ where: eq(schema.guestSessions.id, request.guestSessionId) });
  if (!session) return { ok: false as const, error: 'visit no longer exists' };
  if (session.status === 'authorized' && session.accessUntil && session.accessUntil > new Date()) return { ok: true as const, session };
  return grantVisit(session, request, opts);
}

/** Connects a visit on the strength of an approval, recording who the guest said they were. */
export const grantVisit = (session: GuestSession, request: AccessRequest, opts: { retries?: number } = {}) =>
  authorizeSession(session, {
    retries: opts.retries,
    record: { method: 'approval', name: request.name, email: request.email, locale: normalizeLocale(request.locale) ?? session.locale ?? DEFAULT_LOCALE },
  });

export const listAccessRequests = async (tenantId: string) => {
  const rows = await db.query.accessRequests.findMany({
    where: eq(schema.accessRequests.tenantId, tenantId),
    orderBy: [desc(schema.accessRequests.createdAt)],
    limit: 200,
  });
  // Only the latest request of a device decides; older ones are history
  const seen = new Set<string>();
  return rows.map(({ guestSessionId: _visit, ...r }) => {
    const current = !seen.has(r.clientMac);
    seen.add(r.clientMac);
    return { ...r, status: viewStatus(r), current };
  });
};
