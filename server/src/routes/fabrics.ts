import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import type { UnifiFabric } from '../db/schema.js';
import { audit, tenantScope } from '../lib/auth.js';
import { encrypt } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { checkFabric, linkFabricConsoles, unlinkedHosts } from '../services/fabrics.js';
import { listSiteManagerHosts } from '../services/unifi.js';
import { unifi } from './consoles.js';

export const fabricInput = z.object({ name: z.string().trim().min(1).max(120), apiKey: z.string().trim().min(10) });
export const fabricUpdate = z.object({ name: z.string().trim().min(1).max(120).optional(), apiKey: z.string().trim().optional() });
export const fabricLinkInput = z.object({
  consoles: z.array(z.object({ hostId: z.string().min(1), name: z.string().trim().max(120).optional() })).min(1, 'errors.chooseConsole'),
});

async function publicFabric(f: UnifiFabric) {
  const { apiKey: _key, knownHostIds: _known, ...rest } = f;
  const consoles = await db.query.consoles.findMany({ where: eq(schema.consoles.fabricId, f.id), columns: { id: true } });
  return { ...rest, consoleCount: consoles.length, unlinked: await unlinkedHosts(f) };
}

export async function fabricRoutes(app: FastifyInstance) {
  const find = async (tenantId: string, id: string) => {
    const f = await db.query.unifiFabrics.findFirst({ where: and(eq(schema.unifiFabrics.id, id), eq(schema.unifiFabrics.tenantId, tenantId)) });
    if (!f) throw notFound();
    return f;
  };

  app.get('/api/fabrics', async (req) => {
    const tenantId = tenantScope(req);
    const fabrics = await db.query.unifiFabrics.findMany({ where: eq(schema.unifiFabrics.tenantId, tenantId), orderBy: asc(schema.unifiFabrics.name) });
    return { fabrics: await Promise.all(fabrics.map(publicFabric)) };
  });

  // Checks the key first, so a Fabric is only saved when it reaches at least one console
  app.post('/api/fabrics', async (req) => {
    const tenantId = tenantScope(req, true);
    const body = fabricInput.parse(req.body);
    const hosts = await unifi(() => listSiteManagerHosts(body.apiKey));
    const [f] = await db
      .insert(schema.unifiFabrics)
      .values({ tenantId, name: body.name, apiKey: encrypt(body.apiKey), status: 'ok', lastCheckAt: new Date(), hosts, knownHostIds: hosts.map((h) => h.id) })
      .returning();
    await audit(req, 'fabric.created', { name: f.name, consoles: hosts.length }, tenantId);
    return { fabric: await publicFabric(f) };
  });

  // A new key is checked and then used by every console of the Fabric
  app.put<{ Params: { id: string } }>('/api/fabrics/:id', async (req) => {
    const tenantId = tenantScope(req, true);
    const body = fabricUpdate.parse(req.body);
    const existing = await find(tenantId, req.params.id);
    if (body.apiKey) {
      if (body.apiKey.length < 10) throw badRequest('errors.apiKeyMissing');
      await unifi(() => listSiteManagerHosts(body.apiKey!));
    }
    const apiKey = body.apiKey ? encrypt(body.apiKey) : undefined;
    const updated = await db.transaction(async (tx) => {
      const [f] = await tx
        .update(schema.unifiFabrics)
        .set({ ...(body.name ? { name: body.name } : {}), ...(apiKey ? { apiKey } : {}) })
        .where(eq(schema.unifiFabrics.id, existing.id))
        .returning();
      if (apiKey) await tx.update(schema.consoles).set({ apiKey }).where(eq(schema.consoles.fabricId, existing.id));
      return f;
    });
    await audit(req, 'fabric.updated', { name: updated.name, keyReplaced: Boolean(apiKey) }, tenantId);
    if (apiKey) await checkFabric(updated, body.apiKey);
    return { fabric: await publicFabric((await db.query.unifiFabrics.findFirst({ where: eq(schema.unifiFabrics.id, existing.id) }))!) };
  });

  app.post<{ Params: { id: string } }>('/api/fabrics/:id/check', async (req) => {
    const tenantId = tenantScope(req, true);
    const result = await checkFabric(await find(tenantId, req.params.id));
    return { ...result, fabric: await publicFabric(await find(tenantId, req.params.id)) };
  });

  app.post<{ Params: { id: string } }>('/api/fabrics/:id/consoles', async (req) => {
    const tenantId = tenantScope(req, true);
    const body = fabricLinkInput.parse(req.body);
    const f = await find(tenantId, req.params.id);
    const results = await linkFabricConsoles(f, body.consoles);
    await audit(req, 'fabric.consolesLinked', { name: f.name, consoles: results.filter((r) => r.ok).map((r) => r.name) }, tenantId);
    return { results };
  });

  // Its consoles go with it: they use the Fabric's key
  app.delete<{ Params: { id: string } }>('/api/fabrics/:id', async (req) => {
    const tenantId = tenantScope(req, true);
    const [deleted] = await db
      .delete(schema.unifiFabrics)
      .where(and(eq(schema.unifiFabrics.id, req.params.id), eq(schema.unifiFabrics.tenantId, tenantId)))
      .returning();
    if (!deleted) throw notFound();
    await audit(req, 'fabric.deleted', { name: deleted.name }, tenantId);
    return { ok: true };
  });
}
