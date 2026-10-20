import { and, asc, count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import type { Console } from '../db/schema.js';
import { audit, tenantScope } from '../lib/auth.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { pruneDisabledSites, syncConsole } from '../services/consoles.js';
import { getSettings } from '../services/settings.js';
import { listSiteManagerHosts, listSites, UnifiError, type ConsoleTarget } from '../services/unifi.js';

const connectionInput = z
  .object({
    connection: z.enum(['site_manager', 'direct']),
    hostId: z.string().trim().optional().nullable(),
    baseUrl: z
      .string()
      .trim()
      .regex(/^https:\/\/[^\s/]+(:\d+)?\/?$/, 'errors.consoleUrl')
      .optional()
      .nullable(),
    verifyTls: z.boolean().default(true),
  })
  .refine((v) => (v.connection === 'site_manager' ? Boolean(v.hostId) : Boolean(v.baseUrl)), { message: 'errors.consoleTarget' });

const sitesInput = z.array(z.object({ id: z.string().min(1), internalReference: z.string().min(1), name: z.string() })).min(1, 'errors.chooseSite');

function publicConsole(c: Console) {
  const { apiKey: _key, ...rest } = c;
  return rest;
}

const reload = async (id: string) => (await db.query.consoles.findFirst({ where: eq(schema.consoles.id, id) }))!;

/** UniFi errors are shown as-is (they come from the console); everything else is a server error. */
async function unifi<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UnifiError) throw badRequest('errors.unifi', { reason: err.message });
    throw err;
  }
}

export async function consoleRoutes(app: FastifyInstance) {
  app.get('/api/consoles', async (req) => {
    const tenantId = tenantScope(req);
    const consoles = await db.query.consoles.findMany({ where: eq(schema.consoles.tenantId, tenantId), orderBy: asc(schema.consoles.name) });
    const sites = await db
      .select({ site: schema.consoleSites, devices: count(schema.consoleDevices.mac) })
      .from(schema.consoleSites)
      .leftJoin(schema.consoleDevices, eq(schema.consoleDevices.consoleSiteId, schema.consoleSites.id))
      .where(eq(schema.consoleSites.tenantId, tenantId))
      .groupBy(schema.consoleSites.id);
    const hosting = await getSettings('hosting');
    return {
      // What the customer enters as "External portal server" in UniFi
      portalAddress: hosting.publicIpv4 || null,
      consoles: consoles.map((c) => ({
        ...publicConsole(c),
        sites: sites.filter((s) => s.site.consoleId === c.id).map((s) => ({ ...s.site, deviceCount: s.devices })),
      })),
    };
  });

  // Lists the consoles on a Site Manager account, so the user can pick one instead of typing an id
  app.post('/api/consoles/discover', async (req) => {
    tenantScope(req, true);
    const { apiKey } = z.object({ apiKey: z.string().min(10) }).parse(req.body);
    return { hosts: await unifi(() => listSiteManagerHosts(apiKey)) };
  });

  // Tests a connection and returns its sites; an existing console's stored key is used when none is typed
  app.post('/api/consoles/test', async (req) => {
    const body = z.object({ consoleId: z.string().uuid().optional(), apiKey: z.string().optional() }).passthrough().parse(req.body);
    const tenantId = tenantScope(req, true);
    const conn = connectionInput.parse(req.body);
    let apiKey = body.apiKey ?? '';
    if (!apiKey && body.consoleId) {
      const existing = await db.query.consoles.findFirst({ where: and(eq(schema.consoles.id, body.consoleId), eq(schema.consoles.tenantId, tenantId)) });
      if (!existing) throw notFound();
      apiKey = decrypt(existing.apiKey);
    }
    if (!apiKey) throw badRequest('errors.apiKeyMissing');
    const target: ConsoleTarget = { ...conn, hostId: conn.hostId ?? null, baseUrl: conn.baseUrl ?? null, apiKey };
    const sites = await unifi(() => listSites(target));
    return { sites: sites.map((s) => ({ id: s.id, internalReference: s.internalReference, name: s.name })) };
  });

  app.post('/api/consoles', async (req) => {
    const body = z
      .object({ name: z.string().trim().min(1).max(120), apiKey: z.string().min(10), sites: sitesInput })
      .passthrough()
      .parse(req.body);
    const tenantId = tenantScope(req, true);
    const conn = connectionInput.parse(req.body);
    const created = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(schema.consoles)
        .values({
          tenantId,
          name: body.name,
          connection: conn.connection,
          hostId: conn.connection === 'site_manager' ? conn.hostId : null,
          baseUrl: conn.connection === 'direct' ? conn.baseUrl!.replace(/\/$/, '') : null,
          verifyTls: conn.verifyTls,
          apiKey: encrypt(body.apiKey),
        })
        .returning();
      await tx.insert(schema.consoleSites).values(
        body.sites.map((s) => ({ consoleId: c.id, tenantId, unifiSiteId: s.id, siteName: s.internalReference, displayName: s.name || s.internalReference })),
      );
      return c;
    });
    await audit(req, 'console.created', { name: created.name }, tenantId);
    const sync = await syncConsole(created);
    return { console: publicConsole(await reload(created.id)), sync };
  });

  app.put<{ Params: { id: string } }>('/api/consoles/:id', async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        apiKey: z.string().optional(),
        verifyTls: z.boolean().optional(),
        sites: sitesInput.optional(),
      })
      .parse(req.body);
    const tenantId = tenantScope(req, true);
    const existing = await db.query.consoles.findFirst({ where: and(eq(schema.consoles.id, req.params.id), eq(schema.consoles.tenantId, tenantId)) });
    if (!existing) throw notFound();
    const [updated] = await db
      .update(schema.consoles)
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.verifyTls !== undefined ? { verifyTls: body.verifyTls } : {}),
        ...(body.apiKey ? { apiKey: encrypt(body.apiKey) } : {}),
      })
      .where(eq(schema.consoles.id, existing.id))
      .returning();
    if (body.sites) {
      const current = await db.query.consoleSites.findMany({ where: eq(schema.consoleSites.consoleId, existing.id) });
      const wanted = new Set(body.sites.map((s) => s.id));
      for (const site of current) {
        await db.update(schema.consoleSites).set({ enabled: wanted.has(site.unifiSiteId) }).where(eq(schema.consoleSites.id, site.id));
      }
      const fresh = body.sites.filter((s) => !current.some((c) => c.unifiSiteId === s.id));
      if (fresh.length) {
        await db.insert(schema.consoleSites).values(
          fresh.map((s) => ({ consoleId: existing.id, tenantId, unifiSiteId: s.id, siteName: s.internalReference, displayName: s.name || s.internalReference })),
        );
      }
      await pruneDisabledSites(existing.id);
    }
    await audit(req, 'console.updated', { name: updated.name }, tenantId);
    const sync = await syncConsole(updated);
    return { console: publicConsole(await reload(updated.id)), sync };
  });

  app.post<{ Params: { id: string } }>('/api/consoles/:id/sync', async (req) => {
    const tenantId = tenantScope(req, true);
    const existing = await db.query.consoles.findFirst({ where: and(eq(schema.consoles.id, req.params.id), eq(schema.consoles.tenantId, tenantId)) });
    if (!existing) throw notFound();
    return syncConsole(existing);
  });

  app.delete<{ Params: { id: string } }>('/api/consoles/:id', async (req) => {
    const tenantId = tenantScope(req, true);
    const [deleted] = await db
      .delete(schema.consoles)
      .where(and(eq(schema.consoles.id, req.params.id), eq(schema.consoles.tenantId, tenantId)))
      .returning();
    if (!deleted) throw notFound();
    await audit(req, 'console.deleted', { name: deleted.name }, tenantId);
    return { ok: true };
  });
}
