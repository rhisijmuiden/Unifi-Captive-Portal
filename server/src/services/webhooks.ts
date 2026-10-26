import { createHmac } from 'node:crypto';
import { lookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { and, asc, eq, inArray, isNull, lte, lt, sql } from 'drizzle-orm';
import { Agent, request } from 'undici';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import type { Webhook, WebhookDelivery } from '../db/schema.js';
import { decrypt, encrypt, randomToken } from '../lib/crypto.js';
import type { Audience } from '../api/catalog.js';

type Text = { en: string; nl: string };

/** Events a webhook can subscribe to, per kind of webhook. */
export const webhookEvents: Record<Audience, Record<string, Text>> = {
  tenant: {
    'guest.authorized': { en: 'A guest got access', nl: 'Een gast heeft toegang gekregen' },
    'payment.paid': { en: 'A guest paid for access', nl: 'Een gast heeft betaald voor toegang' },
    'hostname.active': { en: 'A hostname is live: DNS checked and SSL certificate issued', nl: 'Een hostname is live: DNS gecontroleerd en SSL-certificaat uitgegeven' },
    'console.offline': { en: 'A console can no longer be reached', nl: 'Een console is niet meer bereikbaar' },
    'console.online': { en: 'A console can be reached again', nl: 'Een console is weer bereikbaar' },
    'device.offline': { en: 'An access point went offline', nl: 'Een access point is offline gegaan' },
    'device.online': { en: 'An access point is back online', nl: 'Een access point is weer online' },
    'fabric.console_found': { en: 'A new console joined a linked Fabric', nl: 'Er is een nieuwe console bijgekomen in een gekoppelde Fabric' },
    'invoice.issued': { en: 'You received an invoice', nl: 'Je hebt een factuur ontvangen' },
    'invoice.paid': { en: 'An invoice of yours was paid', nl: 'Een factuur van jou is betaald' },
  },
  platform: {
    'tenant.created': { en: 'A customer was created', nl: 'Een klant is aangemaakt' },
    'tenant.updated': { en: 'A customer was changed or suspended', nl: 'Een klant is gewijzigd of opgeschort' },
    'tenant.deleted': { en: 'A customer was deleted', nl: 'Een klant is verwijderd' },
    'invoice.issued': { en: 'An invoice was issued', nl: 'Een factuur is definitief gemaakt' },
    'invoice.paid': { en: 'An invoice was paid', nl: 'Een factuur is betaald' },
    'backup.succeeded': { en: 'A backup succeeded', nl: 'Een back-up is gelukt' },
    'backup.failed': { en: 'A backup failed', nl: 'Een back-up is mislukt' },
  },
};

export type WebhookEvent = keyof (typeof webhookEvents)['tenant'] | keyof (typeof webhookEvents)['platform'];

/** Waiting time before each retry; after the last one the delivery has failed. */
export const RETRY_DELAYS_MIN = [1, 5, 30, 120, 360, 1440];
/** A webhook that keeps failing is switched off, so it does not pile up deliveries. */
export const MAX_FAILURES = 50;
const TIMEOUT_MS = 10_000;

export const newSecret = () => `whsec_${randomToken(24)}`;

export function sign(secret: string, timestamp: number, body: string) {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

// ── Addresses webhooks may call ──────────────────────────────────────────────

const privateRanges = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) privateRanges.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]] as const) privateRanges.addSubnet(net, prefix, 'ipv6');

/** Customers may only call public addresses, so a webhook cannot reach this server or its network. */
export function isPrivateAddress(address: string) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return privateRanges.check(mapped, 'ipv4');
  const family = isIP(address);
  if (!family) return true;
  return privateRanges.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

/** Returns an error key when the address is not allowed, null when it is. */
export function webhookUrlProblem(raw: string, audience: Audience): 'errors.webhookUrl' | 'errors.webhookHttps' | 'errors.webhookPrivate' | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'errors.webhookUrl';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'errors.webhookUrl';
  if (url.username || url.password) return 'errors.webhookUrl';
  if (audience === 'platform') return null;
  if (url.protocol !== 'https:') return 'errors.webhookHttps';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isPrivateAddress(host)) return 'errors.webhookPrivate';
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) return 'errors.webhookPrivate';
  return null;
}

/** Resolves like the system does, but refuses private addresses; checked at connect time, so DNS cannot be switched afterwards. */
function publicOnlyLookup(hostname: string, options: LookupOptions, callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) return callback(Object.assign(new Error(`${hostname} resolves to a private address`), { code: 'EPRIVATE' }), '');
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

const publicAgent = new Agent({ connect: { lookup: publicOnlyLookup as never, timeout: TIMEOUT_MS } });
const anyAgent = new Agent({ connect: { timeout: TIMEOUT_MS } });

// ── Sending ──────────────────────────────────────────────────────────────────

export function publicWebhook(w: Webhook) {
  const { secret: _secret, ...rest } = w;
  return rest;
}

export async function createWebhook(tenantId: string | null, input: { url: string; description: string; events: string[]; active: boolean }) {
  const secret = newSecret();
  const [row] = await db.insert(schema.webhooks).values({ tenantId, ...input, secret: encrypt(secret) }).returning();
  return { webhook: row, secret };
}

export const revealSecret = (w: Webhook) => decrypt(w.secret);

/** Queues an event for every active webhook of the customer (or the platform) that subscribed to it. */
export async function emitEvent(tenantId: string | null, event: WebhookEvent, data: Record<string, unknown>) {
  const hooks = await db.query.webhooks.findMany({
    where: and(tenantId ? eq(schema.webhooks.tenantId, tenantId) : isNull(schema.webhooks.tenantId), eq(schema.webhooks.active, true)),
  });
  const targets = hooks.filter((h) => h.events.includes(event));
  if (!targets.length) return 0;
  const createdAt = new Date();
  const rows = await db
    .insert(schema.webhookDeliveries)
    .values(targets.map((h) => ({ webhookId: h.id, event, payload: { event, createdAt: createdAt.toISOString(), tenantId, data }, nextAttemptAt: createdAt, createdAt })))
    .returning();
  void Promise.all(rows.map((d) => attempt(d.id))).catch((err) => console.error('webhook delivery failed', err));
  return rows.length;
}

/** Same as emitEvent, but never throws: events must not break the action that caused them. */
export function emit(tenantId: string | null, event: WebhookEvent, data: Record<string, unknown>) {
  void emitEvent(tenantId, event, data).catch((err) => console.error(`webhook event ${event} failed`, err));
}

const inFlight = new Set<string>();

/** Sends one delivery now and plans the next try when it fails. */
export async function attempt(deliveryId: string) {
  if (inFlight.has(deliveryId)) return null;
  inFlight.add(deliveryId);
  try {
    const delivery = await db.query.webhookDeliveries.findFirst({ where: eq(schema.webhookDeliveries.id, deliveryId) });
    if (!delivery) return null;
    const hook = await db.query.webhooks.findFirst({ where: eq(schema.webhooks.id, delivery.webhookId) });
    if (!hook) return null;
    const result = await send(hook, delivery);
    const attempts = delivery.attempts + 1;
    const delay = RETRY_DELAYS_MIN[attempts - 1];
    const status: WebhookDelivery['status'] = result.ok ? 'success' : delay === undefined ? 'failed' : 'pending';
    const [updated] = await db
      .update(schema.webhookDeliveries)
      .set({
        status,
        attempts,
        responseStatus: result.status,
        responseBody: result.body,
        error: result.error,
        durationMs: result.durationMs,
        deliveredAt: result.ok ? new Date() : null,
        nextAttemptAt: status === 'pending' ? new Date(Date.now() + delay! * 60_000) : null,
      })
      .where(eq(schema.webhookDeliveries.id, delivery.id))
      .returning();
    if (result.ok) {
      await db.update(schema.webhooks).set({ failures: 0, lastDeliveryAt: new Date() }).where(eq(schema.webhooks.id, hook.id));
    } else {
      const [h] = await db
        .update(schema.webhooks)
        .set({ failures: sql`${schema.webhooks.failures} + 1`, lastDeliveryAt: new Date() })
        .where(eq(schema.webhooks.id, hook.id))
        .returning();
      if (h.failures >= MAX_FAILURES && h.active) {
        await db.update(schema.webhooks).set({ active: false, disabledReason: 'failures' }).where(eq(schema.webhooks.id, hook.id));
        await db.update(schema.webhookDeliveries).set({ status: 'failed', nextAttemptAt: null }).where(and(eq(schema.webhookDeliveries.webhookId, hook.id), eq(schema.webhookDeliveries.status, 'pending')));
      }
    }
    return updated;
  } finally {
    inFlight.delete(deliveryId);
  }
}

async function send(hook: Webhook, delivery: WebhookDelivery) {
  const audience: Audience = hook.tenantId ? 'tenant' : 'platform';
  const started = Date.now();
  const problem = webhookUrlProblem(hook.url, audience);
  if (problem) return { ok: false, status: null, body: null, error: problem, durationMs: 0 };
  const body = JSON.stringify({ id: delivery.id, ...delivery.payload });
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    const res = await request(hook.url, {
      method: 'POST',
      dispatcher: audience === 'tenant' ? publicAgent : anyAgent,
      headers: {
        'content-type': 'application/json',
        'user-agent': `RHIS-Captive-Portal/${config.version}`,
        'x-webhook-id': delivery.id,
        'x-webhook-event': delivery.event,
        'x-webhook-timestamp': String(timestamp),
        'x-webhook-signature': sign(revealSecret(hook), timestamp, body),
      },
      body,
      headersTimeout: TIMEOUT_MS,
      bodyTimeout: TIMEOUT_MS,
    });
    const text = (await res.body.text().catch(() => '')).slice(0, 2000);
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    return { ok, status: res.statusCode, body: text, error: ok ? null : `HTTP ${res.statusCode}`, durationMs: Date.now() - started };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
    const message = e.cause?.code === 'EPRIVATE' || e.code === 'EPRIVATE' ? 'errors.webhookPrivate' : (e.cause?.message ?? e.message);
    return { ok: false, status: null, body: null, error: message, durationMs: Date.now() - started };
  }
}

/** Retries deliveries whose time has come; runs every half minute. */
export async function deliverDue(now = new Date()) {
  const due = await db
    .select({ id: schema.webhookDeliveries.id })
    .from(schema.webhookDeliveries)
    .innerJoin(schema.webhooks, eq(schema.webhooks.id, schema.webhookDeliveries.webhookId))
    .where(and(eq(schema.webhookDeliveries.status, 'pending'), lte(schema.webhookDeliveries.nextAttemptAt, now), eq(schema.webhooks.active, true)))
    .orderBy(asc(schema.webhookDeliveries.nextAttemptAt))
    .limit(50);
  for (const d of due) await attempt(d.id);
  return due.length;
}

/** Delivery history is kept for 30 days. */
export const purgeDeliveries = () =>
  db.delete(schema.webhookDeliveries).where(and(inArray(schema.webhookDeliveries.status, ['success', 'failed']), lt(schema.webhookDeliveries.createdAt, new Date(Date.now() - 30 * 86_400_000))));
