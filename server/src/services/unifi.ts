import { Agent, fetch } from 'undici';
import { config } from '../config.js';
import type { Console } from '../db/schema.js';
import { decrypt } from '../lib/crypto.js';

/**
 * Client for the official UniFi Network Integration API (Network Application 9.1+).
 * A console is reached either through the UniFi Site Manager cloud connector
 * (api.ui.com, no open ports needed) or directly on its own address.
 */

export const SITE_MANAGER_URL = process.env.UNIFI_SITE_MANAGER_URL ?? 'https://api.ui.com';

export class UnifiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

type Page<T> = { offset: number; limit: number; count: number; totalCount: number; data: T[] };
export type UnifiSite = { id: string; internalReference: string; name: string };
export type UnifiDevice = { id: string; macAddress: string; name?: string; model?: string; state?: string };
export type UnifiClient = { id: string; macAddress?: string; name?: string; type?: string; access?: { type?: string; authorized?: boolean } };
export type UnifiHost = { id: string; hardwareId?: string; type?: string; reportedState?: { hostname?: string; name?: string; hardware?: { name?: string; shortname?: string }; version?: string } };

export type GuestLimits = { timeLimitMinutes?: number | null; dataLimitMb?: number | null; downKbps?: number | null; upKbps?: number | null };

export type ConsoleTarget = Pick<Console, 'connection' | 'hostId' | 'baseUrl' | 'verifyTls'> & { apiKey: string };

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

export const normalizeMac = (mac: string) =>
  mac
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '')
    .replace(/(..)(?=.)/g, '$1:');

export function targetFromConsole(c: Console): ConsoleTarget {
  return { connection: c.connection, hostId: c.hostId, baseUrl: c.baseUrl, verifyTls: c.verifyTls, apiKey: decrypt(c.apiKey) };
}

function networkBase(t: ConsoleTarget) {
  if (t.connection === 'site_manager') {
    if (!t.hostId) throw new UnifiError('Missing Site Manager console id');
    return `${SITE_MANAGER_URL}/v1/connector/consoles/${encodeURIComponent(t.hostId)}/proxy/network/integration/v1`;
  }
  if (!t.baseUrl) throw new UnifiError('Missing console address');
  return `${t.baseUrl.replace(/\/$/, '')}/proxy/network/integration/v1`;
}

async function request<T>(url: string, apiKey: string, init: { method?: string; body?: unknown; insecure?: boolean } = {}): Promise<T> {
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        'x-api-key': apiKey,
        accept: 'application/json',
        'user-agent': `captive-portal/${config.version}`,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
      dispatcher: init.insecure ? insecureAgent : undefined,
    });
  } catch (err) {
    throw new UnifiError(`Console unreachable: ${(err as Error).cause ? String((err as Error & { cause: Error }).cause.message) : (err as Error).message}`);
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const msg = (body as { message?: string } | null)?.message ?? res.statusText;
    if (res.status === 401 || res.status === 403) throw new UnifiError(`API key rejected (${res.status})`, res.status);
    throw new UnifiError(`UniFi API ${res.status}: ${msg}`, res.status);
  }
  return body as T;
}

const call = <T>(t: ConsoleTarget, path: string, init: { method?: string; body?: unknown } = {}) =>
  request<T>(`${networkBase(t)}${path}`, t.apiKey, { ...init, insecure: t.connection === 'direct' && !t.verifyTls });

async function all<T>(t: ConsoleTarget, path: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 200) {
    const sep = path.includes('?') ? '&' : '?';
    const page = await call<Page<T>>(t, `${path}${sep}offset=${offset}&limit=200`);
    out.push(...page.data);
    if (out.length >= page.totalCount || page.data.length === 0) return out;
  }
}

/** Consoles on the Site Manager account of this API key, for the "pick your console" list. */
export async function listSiteManagerHosts(apiKey: string) {
  const res = await request<{ data: UnifiHost[] }>(`${SITE_MANAGER_URL}/v1/hosts`, apiKey);
  return res.data
    .filter((h) => !h.type || h.type === 'console' || h.type === 'network-server')
    .map((h) => ({
      id: h.id,
      name: h.reportedState?.name ?? h.reportedState?.hostname ?? h.id,
      model: h.reportedState?.hardware?.name ?? h.reportedState?.hardware?.shortname ?? null,
      version: h.reportedState?.version ?? null,
    }));
}

export const listSites = (t: ConsoleTarget) => all<UnifiSite>(t, '/sites');
export const listDevices = (t: ConsoleTarget, siteId: string) => all<UnifiDevice>(t, `/sites/${encodeURIComponent(siteId)}/devices`);

export async function findClient(t: ConsoleTarget, siteId: string, mac: string): Promise<UnifiClient | null> {
  const wanted = normalizeMac(mac);
  const base = `/sites/${encodeURIComponent(siteId)}/clients`;
  // Newer versions support filtering; older ones ignore or reject it, so fall back to scanning
  try {
    const page = await call<Page<UnifiClient>>(t, `${base}?filter=${encodeURIComponent(`macAddress.eq('${wanted}')`)}`);
    const hit = page.data.find((c) => c.macAddress && normalizeMac(c.macAddress) === wanted);
    if (hit) return hit;
  } catch (err) {
    if (!(err instanceof UnifiError) || err.status !== 400) throw err;
  }
  const clients = await all<UnifiClient>(t, base);
  return clients.find((c) => c.macAddress && normalizeMac(c.macAddress) === wanted) ?? null;
}

export async function authorizeGuest(t: ConsoleTarget, siteId: string, clientId: string, limits: GuestLimits) {
  const body: Record<string, unknown> = { action: 'AUTHORIZE_GUEST_ACCESS' };
  if (limits.timeLimitMinutes) body.timeLimitMinutes = limits.timeLimitMinutes;
  if (limits.dataLimitMb) body.dataUsageLimitMBytes = limits.dataLimitMb;
  // rx/tx are seen from the client: rx = download, tx = upload
  if (limits.downKbps) body.rxRateLimitKbps = limits.downKbps;
  if (limits.upKbps) body.txRateLimitKbps = limits.upKbps;
  return call<unknown>(t, `/sites/${encodeURIComponent(siteId)}/clients/${encodeURIComponent(clientId)}/actions`, { method: 'POST', body });
}
