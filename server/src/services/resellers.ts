import { eq, isNotNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Reseller, User } from '../db/schema.js';
import { normalizeHostname } from '../lib/hostname.js';
import { adminBaseUrl } from './settings.js';

/**
 * White-label resellers: partners who manage their own customers under their own brand.
 * The brand follows the signed-in user (reseller admins and the reseller's customers) or,
 * before signing in, the reseller's own admin hostname.
 */

const TTL = 30_000;
const byId = new Map<string, { value: Reseller | null; at: number }>();
const byHost = new Map<string, { value: string | null; at: number }>();
const byTenant = new Map<string, { value: string | null; at: number }>();

export function clearResellerCache() {
  byId.clear();
  byHost.clear();
  byTenant.clear();
}

export async function resellerById(id: string | null | undefined) {
  if (!id) return null;
  const hit = byId.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = (await db.query.resellers.findFirst({ where: eq(schema.resellers.id, id) })) ?? null;
  byId.set(id, { value, at: Date.now() });
  return value;
}

export async function resellerIdOfTenant(tenantId: string | null | undefined) {
  if (!tenantId) return null;
  const hit = byTenant.get(tenantId);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const row = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, tenantId), columns: { resellerId: true } });
  const value = row?.resellerId ?? null;
  byTenant.set(tenantId, { value, at: Date.now() });
  return value;
}

export const resellerOfTenant = async (tenantId: string | null | undefined) => resellerById(await resellerIdOfTenant(tenantId));

export async function resellerForHost(host: string | undefined) {
  if (!host) return null;
  const key = normalizeHostname(host.replace(/:\d+$/, ''));
  const hit = byHost.get(key);
  let id = hit && Date.now() - hit.at < TTL ? hit.value : undefined;
  if (id === undefined) {
    const row = await db.query.resellers.findFirst({ where: eq(schema.resellers.adminHostname, key), columns: { id: true } });
    id = row?.id ?? null;
    byHost.set(key, { value: id, at: Date.now() });
  }
  return resellerById(id);
}

/** The reseller a user works under: their own (reseller admins) or their customer's. */
export async function resellerOfUser(user: Pick<User, 'resellerId' | 'tenantId'>) {
  if (user.resellerId) return resellerById(user.resellerId);
  return resellerOfTenant(user.tenantId);
}

export type Brand = {
  name: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  accentColor: string | null;
  websiteUrl: string | null;
  supportEmail: string | null;
  showPoweredBy: boolean;
  showDesignedBy: boolean;
};

export const publicBrand = (r: Reseller): Brand => ({
  name: r.brandName,
  logoUrl: r.logoUrl,
  logoDarkUrl: r.logoDarkUrl,
  accentColor: r.accentColor,
  websiteUrl: r.websiteUrl,
  supportEmail: r.supportEmail,
  showPoweredBy: r.showPoweredBy,
  showDesignedBy: r.showDesignedBy,
});

/** The brand for the admin panel: by the signed-in user, else by the address it is opened on. null = RHIS. */
export async function brandFor(user: User | null, host: string | undefined) {
  const r = user ? await resellerOfUser(user) : await resellerForHost(host);
  return r ? publicBrand(r) : null;
}

/** Whether "Designed by RHIS" is shown on a customer's guest portal and e-mails. */
export async function designedByFor(tenantId: string | null | undefined, resellerId?: string | null) {
  const r = resellerId ? await resellerById(resellerId) : await resellerOfTenant(tenantId);
  return r ? r.showDesignedBy : true;
}

/** Base URL for links in e-mails to a user: the reseller's own admin address when it has one. */
export async function baseUrlForUser(user: Pick<User, 'resellerId' | 'tenantId'>) {
  const r = await resellerOfUser(user);
  return r?.adminHostname ? `https://${r.adminHostname}` : adminBaseUrl();
}

/** Admin hostnames of resellers, for Caddy's certificate check. */
export async function resellerHostnames() {
  const rows = await db.select({ host: schema.resellers.adminHostname }).from(schema.resellers).where(isNotNull(schema.resellers.adminHostname));
  return new Set(rows.map((r) => r.host!));
}

export async function tenantIdsOfReseller(resellerId: string) {
  const rows = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.resellerId, resellerId));
  return rows.map((r) => r.id);
}
