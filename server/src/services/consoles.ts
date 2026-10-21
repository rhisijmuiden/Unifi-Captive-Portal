import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Console } from '../db/schema.js';
import { listDevices, normalizeMac, targetFromConsole, UnifiError } from './unifi.js';
import { emit } from './webhooks.js';

/** Refreshes the access-point list of every enabled site, so redirected guests can be matched to a customer. */
export async function syncConsole(c: Console) {
  const target = targetFromConsole(c);
  const sites = await db.query.consoleSites.findMany({ where: and(eq(schema.consoleSites.consoleId, c.id), eq(schema.consoleSites.enabled, true)) });
  try {
    for (const site of sites) {
      const devices = await listDevices(target, site.unifiSiteId);
      const macs = devices.filter((d) => d.macAddress).map((d) => normalizeMac(d.macAddress));
      await db.transaction(async (tx) => {
        for (const d of devices.filter((x) => x.macAddress)) {
          const row = { mac: normalizeMac(d.macAddress), consoleSiteId: site.id, tenantId: c.tenantId, name: d.name ?? null, model: d.model ?? null, updatedAt: new Date() };
          await tx.insert(schema.consoleDevices).values(row).onConflictDoUpdate({ target: schema.consoleDevices.mac, set: row });
        }
        await tx
          .delete(schema.consoleDevices)
          .where(and(eq(schema.consoleDevices.consoleSiteId, site.id), macs.length ? notInArray(schema.consoleDevices.mac, macs) : undefined));
      });
    }
    await db.update(schema.consoles).set({ status: 'ok', lastError: null, lastSyncAt: new Date() }).where(eq(schema.consoles.id, c.id));
    if (c.status === 'error') emit(c.tenantId, 'console.online', { id: c.id, name: c.name });
    return { ok: true as const };
  } catch (err) {
    const message = err instanceof UnifiError ? err.message : String(err);
    await db.update(schema.consoles).set({ status: 'error', lastError: message, lastSyncAt: new Date() }).where(eq(schema.consoles.id, c.id));
    if (c.status !== 'error') emit(c.tenantId, 'console.offline', { id: c.id, name: c.name, error: message });
    return { ok: false as const, error: message };
  }
}

export async function syncAllConsoles() {
  const all = await db.query.consoles.findMany();
  for (const c of all) await syncConsole(c);
}

/** Drops devices of sites that were switched off, so their access points no longer route guests. */
export async function pruneDisabledSites(consoleId: string) {
  const disabled = await db.query.consoleSites.findMany({
    where: and(eq(schema.consoleSites.consoleId, consoleId), eq(schema.consoleSites.enabled, false)),
  });
  if (disabled.length) {
    await db.delete(schema.consoleDevices).where(inArray(schema.consoleDevices.consoleSiteId, disabled.map((s) => s.id)));
  }
}
