import { promises as dns } from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import { eq, inArray } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import type { Hostname } from '../db/schema.js';
import { isValidHostname, normalizeHostname } from '../lib/hostname.js';
import { notifyHostnameLive } from './notifications.js';
import { resellerHostnames } from './resellers.js';
import { getSettings } from './settings.js';
import { emit } from './webhooks.js';

/**
 * Customer hostnames: the customer points an A (and optionally AAAA) record at this
 * server, we verify DNS, then make Caddy fetch a Let's Encrypt certificate on demand.
 */

// Caddy terminates TLS on this address; override for tests or a separate proxy host
const TLS_PROBE_HOST = process.env.TLS_PROBE_HOST ?? '127.0.0.1';
const TLS_PROBE_PORT = Number(process.env.TLS_PROBE_PORT ?? 443);

export { isValidHostname, normalizeHostname };

/** Hostnames that belong to the admin panel and can never be claimed by a customer. */
export async function adminHostnames() {
  const { adminHostname } = await getSettings('hosting');
  const hosts = new Set<string>([new URL(config.publicUrl).hostname]);
  if (adminHostname) hosts.add(adminHostname);
  return hosts;
}

async function resolve(kind: 4 | 6, host: string): Promise<string[]> {
  try {
    return kind === 4 ? await dns.resolve4(host) : await dns.resolve6(host);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENODATA' || code === 'ENOTFOUND' || code === 'ENOTIMP') return [];
    throw err;
  }
}

const sameIpv6 = (a: string, b: string) => {
  const expand = (ip: string) => {
    const [head, tail = ''] = ip.toLowerCase().split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const fill = ip.includes('::') ? Array(8 - h.length - t.length).fill('0') : [];
    return [...h, ...fill, ...t].map((p) => p.replace(/^0+(?=.)/, '')).join(':');
  };
  return expand(a) === expand(b);
};

export type CheckResult = { status: Hostname['status']; error: string | null };

/** DNS must point only at this server, otherwise Let's Encrypt validation can land elsewhere. */
export async function checkDns(host: string): Promise<CheckResult> {
  const { publicIpv4, publicIpv6 } = await getSettings('hosting');
  if (!publicIpv4 && !publicIpv6) return { status: 'error', error: 'hostingIpMissing' };
  const [a, aaaa] = await Promise.all([resolve(4, host), resolve(6, host)]);
  if (!a.length && !aaaa.length) return { status: 'error', error: 'dnsNoRecord' };
  const wrongA = a.filter((ip) => ip !== publicIpv4);
  const wrongAaaa = aaaa.filter((ip) => !publicIpv6 || !sameIpv6(ip, publicIpv6));
  const wrong = [...wrongA, ...wrongAaaa];
  if (wrong.length) return { status: 'error', error: `dnsWrongIp:${wrong.join(', ')}` };
  return { status: 'dns_ok', error: null };
}

/** Connects to Caddy with the hostname as SNI; the first connection triggers the certificate request. */
export function probeTls(host: string, timeoutMs = 90_000): Promise<CheckResult> {
  return new Promise((done) => {
    const socket = tls.connect({ host: TLS_PROBE_HOST, port: TLS_PROBE_PORT, servername: host, timeout: timeoutMs });
    const finish = (r: CheckResult) => {
      socket.destroy();
      done(r);
    };
    socket.once('secureConnect', () =>
      finish(socket.authorized ? { status: 'active', error: null } : { status: 'dns_ok', error: `tlsFailed:${String(socket.authorizationError)}` }),
    );
    socket.once('timeout', () => finish({ status: 'dns_ok', error: 'tlsFailed:timeout' }));
    socket.once('error', (err: NodeJS.ErrnoException) =>
      finish({ status: 'dns_ok', error: err.code === 'ECONNREFUSED' ? 'tlsUnavailable' : `tlsFailed:${err.code ?? err.message}` }),
    );
  });
}

const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL ?? 'http://127.0.0.1:2019';

function portOpen(port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((done) => {
    const socket = net.connect({ host: TLS_PROBE_HOST, port, timeout: timeoutMs });
    const finish = (ok: boolean) => {
      socket.destroy();
      done(ok);
    };
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/** Health of the HTTPS front end, so the platform admin can see why certificates are not issued. */
export async function caddyStatus() {
  const [https, http, config] = await Promise.all([
    portOpen(TLS_PROBE_PORT),
    portOpen(Number(process.env.HTTP_PROBE_PORT ?? 80)),
    fetch(`${CADDY_ADMIN_URL}/config/`, { signal: AbortSignal.timeout(3000) })
      .then(async (r) => (r.ok ? await r.text() : null))
      .catch(() => null),
  ]);
  return {
    https,
    http,
    running: https || http || config !== null,
    // Caddy loaded our Caddyfile when its on-demand check points at this app
    configured: config === null ? null : config.includes('/api/caddy/ask'),
  };
}

export async function checkHostname(h: Hostname) {
  let result = await checkDns(h.hostname);
  if (result.status === 'dns_ok') {
    // Caddy only asks for a certificate once DNS is approved, so store that first
    await db.update(schema.hostnames).set({ status: 'dns_ok' }).where(eq(schema.hostnames.id, h.id));
    result = await probeTls(h.hostname);
  }
  const [updated] = await db
    .update(schema.hostnames)
    .set({
      status: result.status,
      lastError: result.error,
      lastCheckedAt: new Date(),
      ...(result.status === 'active' && !h.activatedAt ? { activatedAt: new Date() } : {}),
    })
    .where(eq(schema.hostnames.id, h.id))
    .returning();
  // First time live: tell the customer that the A record is validated and SSL is in place
  if (updated.status === 'active' && !h.activatedAt) {
    void notifyHostnameLive(updated).catch((err) => console.error('hostname notification failed', err));
    emit(updated.tenantId, 'hostname.active', { id: updated.id, hostname: updated.hostname, activatedAt: updated.activatedAt });
  }
  return updated;
}

/** Background job: pending hostnames are retried often, active ones re-verified now and then. */
export async function checkHostnames(statuses: Hostname['status'][]) {
  const rows = await db.query.hostnames.findMany({ where: inArray(schema.hostnames.status, statuses) });
  for (const h of rows) await checkHostname(h);
}

/** Caddy's on-demand TLS "ask": only hostnames we know and whose DNS was approved get a certificate. */
export async function mayIssueCertificate(domain: string) {
  const host = normalizeHostname(domain);
  if ((await adminHostnames()).has(host)) return true;
  if ((await resellerHostnames()).has(host)) return true;
  const row = await db.query.hostnames.findFirst({ where: eq(schema.hostnames.hostname, host) });
  return row?.status === 'dns_ok' || row?.status === 'active';
}

/** Tenant of a customer hostname, with a short cache because every request is checked. */
const cache = new Map<string, { tenantId: string | null; active: boolean; at: number }>();
export async function hostnameTenant(host: string) {
  const key = normalizeHostname(host.replace(/:\d+$/, ''));
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit;
  const row = await db.query.hostnames.findFirst({ where: eq(schema.hostnames.hostname, key) });
  const value = { tenantId: row?.tenantId ?? null, active: row?.status === 'active', at: Date.now() };
  cache.set(key, value);
  return value;
}
let hostingCache: { value: Awaited<ReturnType<typeof getSettings<'hosting'>>>; at: number } | null = null;
export async function cachedHosting() {
  if (!hostingCache || Date.now() - hostingCache.at > 30_000) hostingCache = { value: await getSettings('hosting'), at: Date.now() };
  return hostingCache.value;
}

export const clearHostnameCache = () => {
  cache.clear();
  hostingCache = null;
};

/** The address guests of a tenant are sent to: its first active hostname over HTTPS. */
export async function tenantPortalOrigin(tenantId: string) {
  const rows = await db.query.hostnames.findMany({ where: eq(schema.hostnames.tenantId, tenantId) });
  const active = rows.filter((r) => r.status === 'active').sort((a, b) => +a.createdAt - +b.createdAt)[0];
  return active ? `https://${active.hostname}` : null;
}
