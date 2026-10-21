import { and, asc, eq, gt, lte, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit, tenantScope } from '../lib/auth.js';
import { sentOnly } from '../lib/patch.js';
import { badRequest, notFound } from '../lib/errors.js';
import { uuidParam } from '../lib/ids.js';
import { addStays, hotelSyncStatus, normalizeRoom, parseStayDate, parseStaysCsv, pmsConfigured, surnameKey, syncHotel, testPms, type StayInput } from '../services/hotel.js';
import { getPublicTenantSettings, getTenantSettings, hotelSettingsSchema, saveTenantSettings } from '../services/tenantSettings.js';

const dateText = z.string().trim().min(8).max(40);
export const stayInput = z.object({
  room: z.string().trim().min(1).max(20),
  surname: z.string().trim().min(1).max(80),
  // "2026-10-21", "21-10-2026" or ISO with time; a departure without time ends at the check-out time
  arrival: dateText,
  departure: dateText,
});
export const staysImport = z.object({
  csv: z.string().max(2_000_000).optional(),
  stays: z.array(stayInput.extend({ externalId: z.string().trim().max(100).optional() })).max(5000).optional(),
  // Replace all stays added by hand, CSV or API (PMS stays are never touched)
  replace: z.boolean().default(false),
});

async function toStay(tenantId: string, input: z.infer<typeof stayInput>): Promise<StayInput> {
  const s = await getTenantSettings(tenantId, 'hotel');
  const arrival = parseStayDate(input.arrival, '00:00');
  const departure = parseStayDate(input.departure, s.checkoutTime);
  if (!arrival || !departure) throw badRequest('errors.dateFormat');
  if (departure <= arrival) throw badRequest('errors.stayDates');
  if (!surnameKey(input.surname) || !normalizeRoom(input.room)) throw badRequest('errors.stayMissing');
  return { room: input.room, surname: input.surname, arrival, departure };
}

const sourceOf = (req: FastifyRequest) => (req.apiKey ? 'api' : 'manual');

export async function hotelRoutes(app: FastifyInstance) {
  app.get('/api/hotel-settings', async (req) => {
    const tenantId = tenantScope(req);
    const s = await getTenantSettings(tenantId, 'hotel');
    return { settings: await getPublicTenantSettings(tenantId, 'hotel'), pmsReady: pmsConfigured(s), sync: hotelSyncStatus(tenantId) };
  });

  app.put('/api/hotel-settings', async (req) => {
    const tenantId = tenantScope(req, true);
    const input = sentOnly(hotelSettingsSchema.partial().passthrough().parse(req.body), req.body) as Record<string, unknown>;
    await saveTenantSettings(tenantId, 'hotel', input);
    await audit(req, 'hotel.settings_updated', { source: input.source }, tenantId);
    const s = await getTenantSettings(tenantId, 'hotel');
    // Fill the list straight away after connecting a PMS
    if (s.source !== 'manual' && pmsConfigured(s)) await syncHotel(tenantId).catch(() => undefined);
    return { settings: await getPublicTenantSettings(tenantId, 'hotel'), pmsReady: pmsConfigured(s), sync: hotelSyncStatus(tenantId) };
  });

  app.post('/api/hotel-settings/test', async (req) => {
    const tenantId = tenantScope(req, true);
    const form = (req.body ?? {}) as Record<string, unknown>;
    const stored = await getTenantSettings(tenantId, 'hotel');
    const filled = Object.fromEntries(Object.entries(form).filter(([, v]) => typeof v === 'string' && v.trim() !== ''));
    return testPms(hotelSettingsSchema.parse({ ...stored, ...filled }));
  });

  app.post('/api/hotel/sync', async (req) => {
    const tenantId = tenantScope(req, true);
    const s = await getTenantSettings(tenantId, 'hotel');
    if (s.source === 'manual' || !pmsConfigured(s)) throw badRequest('errors.pmsSetup');
    const result = await syncHotel(tenantId);
    await audit(req, 'hotel.synced', { stays: result.synced }, tenantId);
    return { ...result, sync: hotelSyncStatus(tenantId) };
  });

  /** Stays: current (in house now), upcoming, or all that have not left yet. */
  app.get<{ Querystring: { scope?: string } }>('/api/hotel/stays', async (req) => {
    const tenantId = tenantScope(req);
    const scope = z.enum(['current', 'upcoming', 'all']).catch('all').parse(req.query.scope);
    const now = new Date();
    const h = schema.hotelStays;
    const where = and(
      eq(h.tenantId, tenantId),
      gt(h.departure, now),
      scope === 'current' ? lte(h.arrival, now) : scope === 'upcoming' ? gt(h.arrival, now) : undefined,
    );
    const rows = await db
      .select({
        stay: h,
        devices: sql<number>`(select count(distinct g.client_mac)::int from guest_sessions g where g.hotel_stay_id = ${h.id} and g.status = 'authorized' and g.access_until > now())`,
      })
      .from(h)
      .where(where)
      .orderBy(asc(h.room), asc(h.arrival))
      .limit(5000);
    return { stays: rows.map((r) => ({ ...r.stay, devices: r.devices })) };
  });

  app.post('/api/hotel/stays', async (req) => {
    const tenantId = tenantScope(req, true);
    const [stay] = await addStays(tenantId, sourceOf(req), [await toStay(tenantId, stayInput.parse(req.body))]);
    await audit(req, 'hotel.stay_added', { room: stay.room }, tenantId);
    return { stay };
  });

  app.put<{ Params: { id: string } }>('/api/hotel/stays/:id', async (req) => {
    const tenantId = tenantScope(req, true);
    const stay = await toStay(tenantId, stayInput.parse(req.body));
    const [row] = await db
      .update(schema.hotelStays)
      .set({ room: normalizeRoom(stay.room), surname: stay.surname, surnameKey: surnameKey(stay.surname), arrival: stay.arrival, departure: stay.departure, updatedAt: new Date() })
      .where(and(eq(schema.hotelStays.id, uuidParam(req.params.id)), eq(schema.hotelStays.tenantId, tenantId)))
      .returning();
    if (!row) throw notFound();
    await audit(req, 'hotel.stay_updated', { room: row.room }, tenantId);
    return { stay: row };
  });

  app.delete<{ Params: { id: string } }>('/api/hotel/stays/:id', async (req) => {
    const tenantId = tenantScope(req, true);
    const [row] = await db
      .delete(schema.hotelStays)
      .where(and(eq(schema.hotelStays.id, uuidParam(req.params.id)), eq(schema.hotelStays.tenantId, tenantId)))
      .returning();
    if (!row) throw notFound();
    await audit(req, 'hotel.stay_deleted', { room: row.room }, tenantId);
    return { ok: true };
  });

  /** Many stays at once: a CSV export from the PMS, or a JSON list from the API. */
  app.post('/api/hotel/stays/import', { bodyLimit: 2_500_000 }, async (req) => {
    const tenantId = tenantScope(req, true);
    const input = staysImport.parse(req.body);
    const s = await getTenantSettings(tenantId, 'hotel');
    let stays: StayInput[] = [];
    let errors: { line: number; reason: string }[] = [];
    if (input.csv) ({ stays, errors } = parseStaysCsv(input.csv, s.checkoutTime));
    else if (input.stays) {
      for (const [i, item] of input.stays.entries()) {
        try {
          stays.push({ ...(await toStay(tenantId, item)), externalId: item.externalId ?? null });
        } catch {
          errors.push({ line: i + 1, reason: 'date' });
        }
      }
    }
    const source = input.csv ? 'csv' : sourceOf(req);
    const saved = await addStays(tenantId, source, stays, input.replace);
    await audit(req, 'hotel.stays_imported', { count: saved.length, errors: errors.length, replace: input.replace }, tenantId);
    return { imported: saved.length, errors: errors.slice(0, 50), errorCount: errors.length };
  });
}
