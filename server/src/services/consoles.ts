import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Console } from '../db/schema.js';
import { consoleRecovered, deviceRecovered } from './monitoring.js';
import { listDevices, normalizeMac, targetFromConsole, UnifiError } from './unifi.js';
import { emit } from './webhooks.js';

/** UniFi reports OFFLINE for an adopted device it cannot reach; updating or pending devices are not down. */
export const isOfflineState = (state: string | null | undefined) => /^(offline|disconnected)$/i.test(state ?? '');

/**
 * Refreshes the access-point list of every enabled site, so redirected guests can be matched
 * to a customer, and keeps track of outages of the console and its access points for monitoring.
 */
export async function syncConsole(c: Console) {
  const target = targetFromConsole(c);
  const sites = await db.query.consoleSites.findMany({ where: and(eq(schema.consoleSites.consoleId, c.id), eq(schema.consoleSites.enabled, true)) });
  const now = new Date();
  try {
    const recovered: { mac: string; name: string | null; model: string | null; siteName: string; since: Date }[] = [];
    const wentDown: { mac: string; name: string | null }[] = [];
    for (const site of sites) {
      const devices = (await listDevices(target, site.unifiSiteId)).filter((d) => d.macAddress);
      const macs = devices.map((d) => normalizeMac(d.macAddress));
      const known = new Map((await db.query.consoleDevices.findMany({ where: eq(schema.consoleDevices.consoleSiteId, site.id) })).map((d) => [d.mac, d]));
      await db.transaction(async (tx) => {
        for (const d of devices) {
          const mac = normalizeMac(d.macAddress);
          const before = known.get(mac);
          const offline = isOfflineState(d.state);
          const offlineSince = offline ? (before?.offlineSince ?? now) : null;
          if (!offline && before?.offlineSince) recovered.push({ mac, name: d.name ?? null, model: d.model ?? null, siteName: site.displayName, since: before.offlineSince });
          if (offline && before && !before.offlineSince) wentDown.push({ mac, name: d.name ?? null });
          const row = { mac, consoleSiteId: site.id, tenantId: c.tenantId, name: d.name ?? null, model: d.model ?? null, state: d.state ?? null, offlineSince, updatedAt: now };
          await tx.insert(schema.consoleDevices).values(row).onConflictDoUpdate({ target: schema.consoleDevices.mac, set: row });
        }
        await tx
          .delete(schema.consoleDevices)
          .where(and(eq(schema.consoleDevices.consoleSiteId, site.id), macs.length ? notInArray(schema.consoleDevices.mac, macs) : undefined));
      });
    }
    await db.update(schema.consoles).set({ status: 'ok', lastError: null, lastSyncAt: now, offlineSince: null }).where(eq(schema.consoles.id, c.id));
    if (c.status === 'error') emit(c.tenantId, 'console.online', { id: c.id, name: c.name });
    if (c.offlineSince) await consoleRecovered(c, c.offlineSince);
    for (const d of wentDown) emit(c.tenantId, 'device.offline', { mac: d.mac, name: d.name, consoleId: c.id });
    for (const d of recovered) {
      emit(c.tenantId, 'device.online', { mac: d.mac, name: d.name, consoleId: c.id });
      await deviceRecovered(c.tenantId, d);
    }
    return { ok: true as const };
  } catch (err) {
    const message = err instanceof UnifiError ? err.message : String(err);
    await db
      .update(schema.consoles)
      .set({ status: 'error', lastError: message, lastSyncAt: now, offlineSince: c.offlineSince ?? now })
      .where(eq(schema.consoles.id, c.id));
    if (c.status !== 'error') emit(c.tenantId, 'console.offline', { id: c.id, name: c.name, error: message });
    return { ok: false as const, error: message };
  }
}

let running = false;

/** Checks every console, a few at a time, so one slow console does not hold up the rest. */
export async function syncAllConsoles(concurrency = 4) {
  if (running) return;
  running = true;
  try {
    const queue = await db.query.consoles.findMany();
    const worker = async () => {
      for (let c = queue.shift(); c; c = queue.shift()) await syncConsole(c).catch((err) => console.error(`console ${c!.id} check failed`, err));
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    running = false;
  }
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
