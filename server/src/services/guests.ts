import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { GuestSession, PortalSettings } from '../db/schema.js';
import { randomToken } from '../lib/crypto.js';
import { authorizeGuest, findClient, normalizeMac, targetFromConsole, UnifiError } from './unifi.js';

/** A guest page that was not used within this time must be reopened through the Wi-Fi redirect. */
export const SESSION_MAX_AGE_MS = 60 * 60 * 1000;

const defaults = (tenantId: string): PortalSettings => ({
  tenantId,
  title: {},
  welcome: {},
  terms: {},
  accentColor: '#FF6B57',
  requireTerms: true,
  timeLimitMinutes: 480,
  dataLimitMb: null,
  downKbps: null,
  upKbps: null,
  successUrl: null,
  updatedAt: new Date(0),
});

export async function getPortalSettings(tenantId: string): Promise<PortalSettings> {
  return (await db.query.portalSettings.findFirst({ where: eq(schema.portalSettings.tenantId, tenantId) })) ?? defaults(tenantId);
}

/**
 * Finds the customer for a redirected guest. The access point MAC is unique across
 * all consoles; the UniFi site name ("default") usually is not, so it is only used
 * when exactly one customer has a site with that name.
 */
export async function resolveSite(siteName: string, apMac: string | null) {
  if (apMac) {
    const [hit] = await db
      .select({ site: schema.consoleSites })
      .from(schema.consoleDevices)
      .innerJoin(schema.consoleSites, eq(schema.consoleSites.id, schema.consoleDevices.consoleSiteId))
      .where(and(eq(schema.consoleDevices.mac, normalizeMac(apMac)), eq(schema.consoleSites.enabled, true)))
      .limit(1);
    if (hit) return hit.site;
  }
  const sites = await db.query.consoleSites.findMany({ where: and(eq(schema.consoleSites.siteName, siteName), eq(schema.consoleSites.enabled, true)) });
  return sites.length === 1 ? sites[0] : null;
}

export async function createGuestSession(input: {
  tenantId: string;
  consoleSiteId: string;
  clientMac: string;
  apMac: string | null;
  ssid: string | null;
  originalUrl: string | null;
}) {
  const [row] = await db
    .insert(schema.guestSessions)
    .values({ ...input, clientMac: normalizeMac(input.clientMac), apMac: input.apMac ? normalizeMac(input.apMac) : null, token: randomToken() })
    .returning();
  return row;
}

export const isExpired = (s: GuestSession) => s.status !== 'authorized' && Date.now() - s.createdAt.getTime() > SESSION_MAX_AGE_MS;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Asks the console to let the guest through, with the customer's limits. */
export async function authorizeSession(s: GuestSession, opts: { retries?: number; retryDelayMs?: number } = {}) {
  const retries = opts.retries ?? 3;
  try {
    if (!s.consoleSiteId) throw new UnifiError('Site no longer linked');
    const site = await db.query.consoleSites.findFirst({ where: eq(schema.consoleSites.id, s.consoleSiteId) });
    const c = site && (await db.query.consoles.findFirst({ where: eq(schema.consoles.id, site.consoleId) }));
    if (!site || !c) throw new UnifiError('Site no longer linked');
    const target = targetFromConsole(c);
    // A guest that just joined can take a moment to show up in the client list
    let client = null;
    for (let i = 0; i <= retries && !client; i++) {
      if (i) await sleep(opts.retryDelayMs ?? 2000);
      client = await findClient(target, site.unifiSiteId, s.clientMac);
    }
    if (!client) throw new UnifiError('Device not found on the network');
    const p = await getPortalSettings(s.tenantId);
    await authorizeGuest(target, site.unifiSiteId, client.id, p);
    const [updated] = await db
      .update(schema.guestSessions)
      .set({ status: 'authorized', error: null, authorizedAt: new Date(), accessUntil: new Date(Date.now() + p.timeLimitMinutes * 60_000) })
      .where(eq(schema.guestSessions.id, s.id))
      .returning();
    return { ok: true as const, session: updated, settings: p };
  } catch (err) {
    const message = err instanceof UnifiError ? err.message : String(err);
    await db.update(schema.guestSessions).set({ status: 'failed', error: message }).where(eq(schema.guestSessions.id, s.id));
    return { ok: false as const, error: message };
  }
}
