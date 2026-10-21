import { and, eq, gt, inArray, lt, lte, notInArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { HotelStay, HotelStaySource } from '../db/schema.js';
import { AppError, badRequest } from '../lib/errors.js';
import { TIME_ZONE } from './reports.js';
import { getTenantSettings, type TenantSettingsValue } from './tenantSettings.js';

/**
 * Hotel login: a guest signs in with room number and surname and stays online until
 * departure. The stays come from the customer's own list (by hand, CSV or the API) or
 * are synced from the PMS (Apaleo or Mews).
 */

type Hotel = TenantSettingsValue<'hotel'>;

/** "012 " → "12", "b 3" → "B3": what guests type rarely matches the PMS exactly. */
export const normalizeRoom = (room: string) => {
  const r = room.replace(/\s+/g, '').toUpperCase().slice(0, 20);
  return /^\d+$/.test(r) ? r.replace(/^0+(?=\d)/, '') : r;
};

const letters = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

/** "Van der Berg-Öztürk" → "vanderbergozturk". */
export const surnameKey = (surname: string) => letters(surname).join('');

/**
 * Whether what the guest typed matches the surname on the booking. Exact (ignoring case,
 * accents, spaces and punctuation), or the last part only: "Berg" for "van den Berg".
 */
export function surnameMatches(stored: string, typed: string): boolean {
  // "Müller" may be typed as "Muller" or "Mueller"
  if (/[äöüÄÖÜ]/.test(stored) && surnameMatches(stored.replace(/[äöüÄÖÜ]/g, (c) => `${c.normalize('NFD')[0]}e`), typed)) return true;
  const a = letters(stored);
  const b = letters(typed);
  if (!a.length || !b.length) return false;
  if (a.join('') === b.join('')) return true;
  return b.length === 1 && b[0].length >= 2 && (a.at(-1) === b[0] || (b[0].length >= 4 && a.join('').endsWith(b[0])));
}

/** Offset of a time zone from UTC at a moment, in minutes. */
function zoneOffset(at: number, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (local - Math.floor(at / 1000) * 1000) / 60_000;
}

/** A local date and time in a time zone (Europe/Amsterdam by default) as a moment. */
export function zonedTime(date: string, time: string, tz = TIME_ZONE) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - zoneOffset(guess, tz) * 60_000;
  return new Date(guess - zoneOffset(first, tz) * 60_000);
}

/**
 * A date from a form, CSV or API: ISO with time zone, "2026-10-21", "21-10-2026" or
 * "21/10/2026", each optionally followed by a time. Without a time `time` is used.
 */
export function parseStayDate(value: string, time: string, tz = TIME_ZONE): Date | null {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}T.+([zZ]|[+-]\d{2}:?\d{2})$/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = v.match(/^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}))(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const [y, mo, d] = m[1] ? [m[1], m[2], m[3]] : [m[6], m[5], m[4]];
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
  const date = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return zonedTime(date, m[7] ? `${m[7].padStart(2, '0')}:${m[8]}` : time, tz);
}

export type StayInput = { room: string; surname: string; arrival: Date; departure: Date; externalId?: string | null };

const HEADER = {
  room: /^(room|kamer|zimmer|chambre|unit|kamernummer|room ?number|roomnumber)$/i,
  surname: /^(surname|last ?name|lastname|family ?name|achternaam|naam|name|nachname|nom)$/i,
  arrival: /^(arrival|check ?in|checkin|aankomst|from|van|anreise|arrivée|arrivee)$/i,
  departure: /^(departure|check ?out|checkout|vertrek|to|tot|until|abreise|départ|depart)$/i,
};

/**
 * Reads a CSV export: room, surname, arrival, departure. A header row with recognisable
 * names may put the columns in any order; without it that order is assumed.
 */
export function parseStaysCsv(text: string, checkoutTime: string, tz = TIME_ZONE) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { stays: [] as StayInput[], errors: [] as { line: number; reason: string }[] };
  const sep = [';', '\t', ','].map((c) => [c, lines[0].split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const split = (l: string) => {
    const cells: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"' && quoted && l[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = !quoted;
      else if (c === sep && !quoted) cells.push(cur.trim()), (cur = '');
      else cur += c;
    }
    cells.push(cur.trim());
    return cells;
  };
  let cols = { room: 0, surname: 1, arrival: 2, departure: 3 };
  let start = 0;
  const head = split(lines[0]);
  const found = Object.fromEntries(Object.entries(HEADER).map(([k, re]) => [k, head.findIndex((h) => re.test(h))])) as typeof cols;
  if (Object.values(found).every((i) => i >= 0)) (cols = found), (start = 1);
  else if (!parseStayDate(head[3] ?? '', '00:00', tz)) start = 1;
  const stays: StayInput[] = [];
  const errors: { line: number; reason: string }[] = [];
  for (let i = start; i < lines.length && stays.length + errors.length < 5000; i++) {
    const c = split(lines[i]);
    const room = normalizeRoom(c[cols.room] ?? '');
    const surname = (c[cols.surname] ?? '').slice(0, 80);
    const arrival = parseStayDate(c[cols.arrival] ?? '', '00:00', tz);
    const departure = parseStayDate(c[cols.departure] ?? '', checkoutTime, tz);
    if (!room || !surnameKey(surname)) errors.push({ line: i + 1, reason: 'missing' });
    else if (!arrival || !departure) errors.push({ line: i + 1, reason: 'date' });
    else if (departure <= arrival) errors.push({ line: i + 1, reason: 'order' });
    else stays.push({ room, surname, arrival, departure });
  }
  return { stays, errors };
}

const row = (tenantId: string, source: HotelStaySource, s: StayInput) => ({
  tenantId,
  source,
  room: normalizeRoom(s.room),
  surname: s.surname.trim().slice(0, 80),
  surnameKey: surnameKey(s.surname),
  arrival: s.arrival,
  departure: s.departure,
  externalId: s.externalId ?? null,
});

export async function addStays(tenantId: string, source: HotelStaySource, stays: StayInput[], replace = false) {
  return db.transaction(async (tx) => {
    if (replace) await tx.delete(schema.hotelStays).where(and(eq(schema.hotelStays.tenantId, tenantId), inArray(schema.hotelStays.source, ['manual', 'csv'])));
    // One row per reservation id: the last one in the list wins
    const byId = new Map(stays.map((s, i) => [s.externalId ?? `#${i}`, s]));
    stays = [...byId.values()];
    if (!stays.length) return [];
    // Stays with a reservation id are updated when sent again (API imports)
    const excluded = (c: string) => sql.raw(`excluded.${c}`);
    return tx
      .insert(schema.hotelStays)
      .values(stays.map((s) => row(tenantId, source, s)))
      .onConflictDoUpdate({
        target: [schema.hotelStays.tenantId, schema.hotelStays.source, schema.hotelStays.externalId],
        set: { room: excluded('room'), surname: excluded('surname'), surnameKey: excluded('surname_key'), arrival: excluded('arrival'), departure: excluded('departure'), updatedAt: new Date() },
      })
      .returning();
  });
}

/** Guest sign-in attempts per room, to stop guessing surnames; kept in memory, 15 minutes. */
const failures = new Map<string, number[]>();
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60_000;

export function roomLocked(tenantId: string, room: string, now = Date.now()) {
  const key = `${tenantId}:${normalizeRoom(room)}`;
  const list = (failures.get(key) ?? []).filter((t) => now - t < LOCK_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list.length >= LOCK_AFTER;
}

export function roomFailed(tenantId: string, room: string, now = Date.now()) {
  const key = `${tenantId}:${normalizeRoom(room)}`;
  failures.set(key, [...(failures.get(key) ?? []).filter((t) => now - t < LOCK_MS), now]);
}

export const clearRoomFailures = () => failures.clear();

/** The current stay for a room and surname, if any. */
export async function findStay(tenantId: string, room: string, surname: string, now = new Date()): Promise<HotelStay | null> {
  const r = normalizeRoom(room);
  if (!r) return null;
  const stays = await db.query.hotelStays.findMany({
    // Early check-in: from midnight on the arrival day
    where: and(eq(schema.hotelStays.tenantId, tenantId), eq(schema.hotelStays.room, r), gt(schema.hotelStays.departure, now), lte(schema.hotelStays.arrival, new Date(now.getTime() + 24 * 3600_000))),
  });
  return stays.find((s) => surnameMatches(s.surname, surname)) ?? null;
}

/** Devices already online on this stay, other than this one. */
export async function devicesOnStay(stayId: string, clientMac: string) {
  const [r] = await db
    .select({ n: sql<number>`count(distinct ${schema.guestSessions.clientMac})::int` })
    .from(schema.guestSessions)
    .where(
      and(
        eq(schema.guestSessions.hotelStayId, stayId),
        eq(schema.guestSessions.status, 'authorized'),
        gt(schema.guestSessions.accessUntil, new Date()),
        sql`${schema.guestSessions.clientMac} <> ${clientMac}`,
      ),
    );
  return r?.n ?? 0;
}

// ── PMS sync ──

const APALEO_IDENTITY = process.env.APALEO_IDENTITY_URL ?? 'https://identity.apaleo.com';
const APALEO_API = process.env.APALEO_API_URL ?? 'https://api.apaleo.com';

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { message?: string; Message?: string; error_description?: string; error?: string };
  if (!res.ok) throw new Error(body.message ?? body.Message ?? body.error_description ?? body.error ?? `HTTP ${res.status}`);
  return body;
}

/** Apaleo: OAuth client credentials, then the in-house and arriving reservations of one property. */
async function apaleoStays(s: Hotel, now: Date): Promise<StayInput[]> {
  const token = await json<{ access_token: string }>(
    await fetch(`${APALEO_IDENTITY}/connect/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${s.apaleoClientId}:${s.apaleoClientSecret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(15_000),
    }),
  );
  const params = new URLSearchParams({
    propertyIds: s.apaleoPropertyId,
    status: 'Confirmed,InHouse',
    dateFilter: 'Stay',
    from: now.toISOString(),
    to: new Date(now.getTime() + 24 * 3600_000).toISOString(),
    pageSize: '1000',
  });
  const res = await fetch(`${APALEO_API}/booking/v1/reservations?${params}`, { headers: { authorization: `Bearer ${token.access_token}`, accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (res.status === 204) return [];
  const body = await json<{ reservations?: { id: string; arrival: string; departure: string; unit?: { name?: string }; primaryGuest?: { lastName?: string } }[] }>(res);
  return (body.reservations ?? [])
    .filter((r) => r.unit?.name && r.primaryGuest?.lastName)
    .map((r) => ({ externalId: r.id, room: r.unit!.name!, surname: r.primaryGuest!.lastName!, arrival: new Date(r.arrival), departure: new Date(r.departure) }));
}

/** Mews Connector API: started and confirmed reservations around now, with room and customer names. */
async function mewsStays(s: Hotel, now: Date): Promise<StayInput[]> {
  const base = (s.mewsPlatformUrl || 'https://api.mews.com').replace(/\/$/, '');
  const auth = { ClientToken: s.mewsClientToken, AccessToken: s.mewsAccessToken, Client: 'RHIS Captive Portal' };
  const call = async <T>(op: string, body: Record<string, unknown>) =>
    json<T>(await fetch(`${base}/api/connector/v1/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...auth, ...body }), signal: AbortSignal.timeout(30_000) }));
  type Reservation = { Id: string; State?: string; AssignedResourceId?: string | null; AccountId?: string; CustomerId?: string; ScheduledStartUtc?: string; StartUtc?: string; ScheduledEndUtc?: string; EndUtc?: string };
  const { Reservations = [] } = await call<{ Reservations?: Reservation[] }>('reservations/getAll/2023-06-06', {
    States: ['Started', 'Confirmed'],
    CollidingUtc: { StartUtc: now.toISOString(), EndUtc: new Date(now.getTime() + 24 * 3600_000).toISOString() },
    Limitation: { Count: 1000 },
  });
  const list = Reservations.filter((r) => r.AssignedResourceId && (r.AccountId ?? r.CustomerId));
  if (!list.length) return [];
  const resourceIds = [...new Set(list.map((r) => r.AssignedResourceId!))];
  const customerIds = [...new Set(list.map((r) => (r.AccountId ?? r.CustomerId)!))];
  const [{ Resources = [] }, { Customers = [] }] = await Promise.all([
    call<{ Resources?: { Id: string; Name: string }[] }>('resources/getAll', { ResourceIds: resourceIds, Limitation: { Count: 1000 } }),
    call<{ Customers?: { Id: string; LastName?: string }[] }>('customers/getAll', { CustomerIds: customerIds, Limitation: { Count: 1000 } }),
  ]);
  const rooms = new Map(Resources.map((r) => [r.Id, r.Name]));
  const names = new Map(Customers.map((c) => [c.Id, c.LastName ?? '']));
  return list
    .map((r) => ({
      externalId: r.Id,
      room: rooms.get(r.AssignedResourceId!) ?? '',
      surname: names.get((r.AccountId ?? r.CustomerId)!) ?? '',
      arrival: new Date(r.ScheduledStartUtc ?? r.StartUtc ?? now),
      departure: new Date(r.ScheduledEndUtc ?? r.EndUtc ?? now),
    }))
    .filter((r) => r.room && surnameKey(r.surname) && r.departure > now);
}

export const pmsConfigured = (s: Hotel) =>
  (s.source === 'apaleo' && Boolean(s.apaleoClientId && s.apaleoClientSecret && s.apaleoPropertyId)) ||
  (s.source === 'mews' && Boolean(s.mewsClientToken && s.mewsAccessToken));

async function fetchPms(s: Hotel, now: Date) {
  try {
    return s.source === 'apaleo' ? await apaleoStays(s, now) : await mewsStays(s, now);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw badRequest('errors.pmsApi', { reason: (err as Error).message });
  }
}

/** Fetches the reservations without saving them: for the "test connection" button. */
export async function testPms(s: Hotel) {
  if (!pmsConfigured(s)) throw badRequest('errors.pmsSetup');
  const stays = await fetchPms(s, new Date());
  return { ok: true, stays: stays.length };
}

const lastSync = new Map<string, number>();
const lastResult = new Map<string, { at: string; synced?: number; error?: string }>();
export const hotelSyncStatus = (tenantId: string) => lastResult.get(tenantId) ?? null;

/** Replaces the PMS stays of a customer with what the PMS has now. */
export async function syncHotel(tenantId: string, now = new Date()) {
  const s = await getTenantSettings(tenantId, 'hotel');
  if (s.source === 'manual' || !pmsConfigured(s)) return { synced: 0, skipped: true };
  lastSync.set(tenantId, Date.now());
  const source = s.source;
  let fetched: StayInput[];
  try {
    fetched = await fetchPms(s, now);
  } catch (err) {
    lastResult.set(tenantId, { at: new Date().toISOString(), error: err instanceof AppError ? String(err.params?.reason ?? err.key) : (err as Error).message });
    throw err;
  }
  const stays = fetched.filter((r) => !Number.isNaN(r.arrival.getTime()) && !Number.isNaN(r.departure.getTime()));
  await db.transaction(async (tx) => {
    const ids = stays.map((r) => r.externalId!);
    const mine = and(eq(schema.hotelStays.tenantId, tenantId), eq(schema.hotelStays.source, source));
    await tx.delete(schema.hotelStays).where(ids.length ? and(mine, notInArray(schema.hotelStays.externalId, ids)) : mine);
    for (const r of stays) {
      const v = row(tenantId, source, r);
      await tx
        .insert(schema.hotelStays)
        .values(v)
        .onConflictDoUpdate({ target: [schema.hotelStays.tenantId, schema.hotelStays.source, schema.hotelStays.externalId], set: { ...v, updatedAt: new Date() } });
    }
  });
  lastResult.set(tenantId, { at: new Date().toISOString(), synced: stays.length });
  return { synced: stays.length, skipped: false };
}

/** A sync right now unless one ran in the last minute: when a guest's room is not found yet. */
export async function syncIfStale(tenantId: string) {
  if (Date.now() - (lastSync.get(tenantId) ?? 0) < 60_000) return false;
  const r = await syncHotel(tenantId).catch(() => ({ skipped: true }));
  return !r.skipped;
}

/** Every 10 minutes: all customers that connected a PMS. */
export async function syncAllHotels() {
  const rows = await db.select({ tenantId: schema.tenantSettings.tenantId }).from(schema.tenantSettings).where(eq(schema.tenantSettings.key, 'hotel'));
  for (const { tenantId } of rows) {
    await syncHotel(tenantId).catch((err) => console.warn(`hotel sync ${tenantId}: ${(err as Error).message}`));
  }
}

/** Stays are removed a week after departure. */
export const purgeOldStays = () => db.delete(schema.hotelStays).where(lt(schema.hotelStays.departure, new Date(Date.now() - 7 * 86_400_000)));
