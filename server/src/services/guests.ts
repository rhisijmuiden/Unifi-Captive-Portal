import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { defaultPortalAuth, type GuestSession, type PortalSettings } from '../db/schema.js';
import type { PortalDesign } from '../shared/portalDesign.js';
import { defaultDesign } from '../shared/portalTemplates.js';
import { randomToken } from '../lib/crypto.js';
import { authorizeGuest, findClient, normalizeMac, targetFromConsole, UnifiError, type GuestLimits } from './unifi.js';
import { recordContact } from './marketing.js';
import { emit } from './webhooks.js';

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
  design: null,
  auth: { ...defaultPortalAuth },
  languages: ['en', 'nl'],
  updatedAt: new Date(0),
});

export async function getPortalSettings(tenantId: string): Promise<PortalSettings> {
  const row = await db.query.portalSettings.findFirst({ where: eq(schema.portalSettings.tenantId, tenantId) });
  return row ? { ...row, auth: { ...defaultPortalAuth, ...row.auth } } : defaults(tenantId);
}

/** The portal design; before the editor was used, the default template with the texts from "Portal & access". */
export function designFor(p: PortalSettings): PortalDesign {
  if (p.design) return p.design;
  const d = defaultDesign();
  d.theme.accent = p.accentColor;
  for (const b of d.blocks) {
    if (b.type === 'heading' && Object.values(p.title).some(Boolean)) b.text = { ...p.title };
    if (b.type === 'text' && Object.values(p.welcome).some(Boolean)) b.text = { ...p.welcome };
  }
  return d;
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

type AuthorizeOptions = {
  retries?: number;
  retryDelayMs?: number;
  /** Limits of a voucher or package instead of the portal's defaults. */
  limits?: GuestLimits & { timeLimitMinutes: number };
  /** Short access while paying: the console lets the guest through, the session stays pending. */
  temporary?: boolean;
  /** Extra fields stored on the session once access is granted (method, e-mail, …). */
  record?: Partial<Pick<GuestSession, 'method' | 'name' | 'email' | 'phone' | 'marketingOptIn' | 'voucherId' | 'paymentId' | 'hotelStayId' | 'locale'>>;
};

/** Asks the console to let the guest through, with the customer's limits. */
export async function authorizeSession(s: GuestSession, opts: AuthorizeOptions = {}) {
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
    const limits = opts.limits ?? p;
    await authorizeGuest(target, site.unifiSiteId, client.id, limits);
    if (opts.temporary) return { ok: true as const, session: s, settings: p };
    const [updated] = await db
      .update(schema.guestSessions)
      .set({
        ...opts.record,
        status: 'authorized',
        error: null,
        authorizedAt: new Date(),
        accessUntil: new Date(Date.now() + (limits.timeLimitMinutes ?? p.timeLimitMinutes) * 60_000),
      })
      .where(eq(schema.guestSessions.id, s.id))
      .returning();
    emit(s.tenantId, 'guest.authorized', {
      id: updated.id,
      clientMac: updated.clientMac,
      apMac: updated.apMac,
      ssid: updated.ssid,
      method: updated.method,
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      marketingOptIn: updated.marketingOptIn,
      locale: updated.locale,
      authorizedAt: updated.authorizedAt,
      accessUntil: updated.accessUntil,
    });
    // The contact list for marketing; never blocks the guest
    void recordContact(updated).catch((err) => console.warn(`recording contact failed: ${(err as Error).message}`));
    return { ok: true as const, session: updated, settings: p };
  } catch (err) {
    const message = err instanceof UnifiError ? err.message : String(err);
    // A failed short access while paying does not fail the session: the payment can still complete
    if (!opts.temporary) await db.update(schema.guestSessions).set({ status: 'failed', error: message }).where(eq(schema.guestSessions.id, s.id));
    return { ok: false as const, error: message };
  }
}
