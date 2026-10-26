import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { FabricHost, UnifiFabric } from '../db/schema.js';
import { decrypt } from '../lib/crypto.js';
import { syncConsole } from './consoles.js';
import { deliver } from './notifications.js';
import { adminBaseUrl } from './settings.js';
import { getTenantSettings } from './tenantSettings.js';
import { listSiteManagerHosts, listSites, UnifiError } from './unifi.js';
import { emit } from './webhooks.js';

/**
 * UniFi Fabrics: one Site Manager key for a whole Fabric (or organisation). The Fabric is checked
 * regularly, so a console that joins it later is reported to the customer to link.
 */

/** Consoles of the Fabric that are not linked to this customer's portal yet. */
export async function unlinkedHosts(f: UnifiFabric) {
  const linked = await db.query.consoles.findMany({ where: eq(schema.consoles.tenantId, f.tenantId), columns: { hostId: true } });
  const ids = new Set(linked.map((c) => c.hostId));
  return f.hosts.filter((h) => !ids.has(h.id));
}

/** Refreshes the console list of a Fabric; returns the consoles that joined since the last check. */
export async function checkFabric(f: UnifiFabric, apiKey = decrypt(f.apiKey)) {
  const now = new Date();
  let hosts: FabricHost[];
  try {
    hosts = await listSiteManagerHosts(apiKey);
  } catch (err) {
    const message = err instanceof UnifiError ? err.message : String(err);
    await db.update(schema.unifiFabrics).set({ status: 'error', lastError: message, lastCheckAt: now }).where(eq(schema.unifiFabrics.id, f.id));
    return { ok: false as const, error: message, found: [] as FabricHost[] };
  }
  // The first check only records what is there; the customer picks from that list right away
  const firstCheck = !f.lastCheckAt;
  const known = new Set(f.knownHostIds);
  const fresh = hosts.filter((h) => !known.has(h.id));
  const [updated] = await db
    .update(schema.unifiFabrics)
    .set({ status: 'ok', lastError: null, lastCheckAt: now, hosts, knownHostIds: [...known, ...fresh.map((h) => h.id)] })
    .where(eq(schema.unifiFabrics.id, f.id))
    .returning();
  const unlinked = new Set((await unlinkedHosts(updated)).map((h) => h.id));
  const found = firstCheck ? [] : fresh.filter((h) => unlinked.has(h.id));
  if (found.length) await reportFound(updated, found);
  return { ok: true as const, found };
}

async function reportFound(f: UnifiFabric, found: FabricHost[]) {
  emit(f.tenantId, 'fabric.console_found', { fabricId: f.id, fabricName: f.name, consoles: found.map((h) => ({ hostId: h.id, name: h.name, model: h.model })) });
  const settings = await getTenantSettings(f.tenantId, 'notifications');
  if (!settings.fabricConsoleFound) return;
  const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, f.tenantId) });
  const actionUrl = `${await adminBaseUrl()}/consoles`;
  const ref = `${f.id}:${found.map((h) => h.id).sort().join(',')}`.slice(0, 500);
  await deliver(f.tenantId, 'fabricConsoleFound', ref, () => ({
    vars: { tenantName: tenant?.name ?? '', fabricName: f.name, consoleNames: found.map((h) => h.name).join(', '), actionUrl },
  }));
}

let running = false;

export async function checkAllFabrics() {
  if (running) return;
  running = true;
  try {
    for (const f of await db.query.unifiFabrics.findMany()) await checkFabric(f).catch((err) => console.error(`fabric ${f.id} check failed`, err));
  } finally {
    running = false;
  }
}

export type LinkResult = { hostId: string; name: string; ok: boolean; consoleId?: string; error?: string; sync?: { ok: boolean; error?: string } };

/**
 * Links consoles of a Fabric with all their sites, each with a copy of the Fabric's key.
 * Sites can be narrowed per console afterwards; a console that fails does not stop the others.
 */
export async function linkFabricConsoles(f: UnifiFabric, picks: { hostId: string; name?: string }[]): Promise<LinkResult[]> {
  const apiKey = decrypt(f.apiKey);
  const results: LinkResult[] = [];
  for (const pick of picks) {
    const host = f.hosts.find((h) => h.id === pick.hostId);
    const name = pick.name?.trim() || host?.name || pick.hostId;
    const existing = await db.query.consoles.findFirst({ where: and(eq(schema.consoles.tenantId, f.tenantId), eq(schema.consoles.hostId, pick.hostId)) });
    if (existing) {
      results.push({ hostId: pick.hostId, name, ok: true, consoleId: existing.id });
      continue;
    }
    try {
      const sites = await listSites({ connection: 'site_manager', hostId: pick.hostId, baseUrl: null, verifyTls: true, apiKey });
      if (!sites.length) throw new UnifiError('No sites found on this console');
      const created = await db.transaction(async (tx) => {
        const [c] = await tx
          .insert(schema.consoles)
          .values({ tenantId: f.tenantId, name, connection: 'site_manager', hostId: pick.hostId, fabricId: f.id, apiKey: f.apiKey })
          .returning();
        await tx.insert(schema.consoleSites).values(
          sites.map((s) => ({ consoleId: c.id, tenantId: f.tenantId, unifiSiteId: s.id, siteName: s.internalReference, displayName: s.name || s.internalReference })),
        );
        return c;
      });
      results.push({ hostId: pick.hostId, name, ok: true, consoleId: created.id, sync: await syncConsole(created) });
    } catch (err) {
      results.push({ hostId: pick.hostId, name, ok: false, error: err instanceof UnifiError ? err.message : String(err) });
    }
  }
  return results;
}
