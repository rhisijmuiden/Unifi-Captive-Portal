import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { scopes, type Audience } from '../api/catalog.js';
import { buildOpenApi } from '../api/openapi.js';
import { db, schema } from '../db/index.js';
import { normalizeLocale, requestLocale } from '../i18n/index.js';
import { audit, requireUser } from '../lib/auth.js';
import { sentOnly } from '../lib/patch.js';
import { encrypt } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { uuidParam } from '../lib/ids.js';
import { cleanScopes, listKeys, newKey, ownKey, publicKey, REQUEST_LOG_DAYS } from '../services/apiKeys.js';
import { adminBaseUrl } from '../services/settings.js';
import { attempt, createWebhook, newSecret, RETRY_DELAYS_MIN, publicWebhook, revealSecret, webhookEvents, webhookUrlProblem } from '../services/webhooks.js';

/**
 * Managing API keys and webhooks. A customer admin manages those of their own environment,
 * the platform admin those of the platform API. Keys themselves cannot reach these routes.
 */
function owner(req: FastifyRequest): { tenantId: string | null; audience: Audience } {
  const user = requireUser(req);
  if (req.apiKey) throw forbidden();
  if (user.role === 'superadmin') return { tenantId: null, audience: 'platform' };
  if (user.role === 'tenant_admin' && user.tenantId) return { tenantId: user.tenantId, audience: 'tenant' };
  throw forbidden();
}

const keyInput = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.string()).max(100),
  // Requests per minute
  rateLimit: z.coerce.number().int().min(1).max(10_000).default(120),
  expiresAt: z.coerce.date().nullable().default(null),
});

const webhookInput = z.object({
  url: z.string().trim().max(2000),
  description: z.string().trim().max(200).default(''),
  events: z.array(z.string()).max(50),
  active: z.boolean().default(true),
});

const ownWebhook = async (id: string, tenantId: string | null) => {
  const row = await db.query.webhooks.findFirst({
    where: and(eq(schema.webhooks.id, uuidParam(id)), tenantId ? eq(schema.webhooks.tenantId, tenantId) : isNull(schema.webhooks.tenantId)),
  });
  if (!row) throw notFound();
  return row;
};

export async function apiRoutes(app: FastifyInstance) {
  // ── Description of the API ───────────────────────────────────────────────
  // Public: /api/v1/openapi.json?audience=platform&lang=nl, for tools such as Postman or code generators
  app.get<{ Querystring: { audience?: string; lang?: string } }>('/api/openapi.json', async (req) => {
    const audience: Audience = req.query.audience === 'platform' ? 'platform' : 'tenant';
    return buildOpenApi(audience, normalizeLocale(req.query.lang) ?? requestLocale(req), await adminBaseUrl());
  });

  // The description for the signed-in user's own kind of API, for the explorer in the interface
  app.get('/api/api-docs', async (req) => {
    const { audience } = owner(req);
    return { audience, spec: buildOpenApi(audience, requestLocale(req), await adminBaseUrl()) };
  });

  // ── Keys ─────────────────────────────────────────────────────────────────
  app.get('/api/api-keys', async (req) => {
    const { tenantId, audience } = owner(req);
    const locale = requestLocale(req);
    return {
      audience,
      keys: await listKeys(tenantId),
      scopes: Object.entries(scopes[audience]).map(([name, text]) => ({ name, label: text[locale] })),
      baseUrl: `${await adminBaseUrl()}/api/v1`,
    };
  });

  app.post('/api/api-keys', async (req) => {
    const { tenantId, audience } = owner(req);
    const user = requireUser(req);
    const body = keyInput.parse(req.body);
    const granted = cleanScopes(audience, body.scopes);
    if (!granted.length) throw badRequest('errors.apiScopesEmpty');
    const { token, prefix, hash } = newKey();
    const [row] = await db
      .insert(schema.apiKeys)
      .values({ tenantId, name: body.name, prefix, keyHash: hash, scopes: granted, rateLimit: body.rateLimit, expiresAt: body.expiresAt, createdBy: user.id })
      .returning();
    await audit(req, 'api.key.created', { name: row.name, scopes: granted }, tenantId);
    // The key is shown once; only its hash is kept
    return { key: publicKey(row), token };
  });

  app.put<{ Params: { id: string } }>('/api/api-keys/:id', async (req) => {
    const { tenantId, audience } = owner(req);
    const key = await ownKey(uuidParam(req.params.id), tenantId);
    if (!key) throw notFound();
    const body = sentOnly(keyInput.partial().parse(req.body), req.body);
    const patch: Partial<typeof key> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.rateLimit !== undefined) patch.rateLimit = body.rateLimit;
    if (body.expiresAt !== undefined) patch.expiresAt = body.expiresAt;
    if (body.scopes !== undefined) {
      patch.scopes = cleanScopes(audience, body.scopes);
      if (!patch.scopes.length) throw badRequest('errors.apiScopesEmpty');
    }
    const [row] = await db.update(schema.apiKeys).set(patch).where(eq(schema.apiKeys.id, key.id)).returning();
    await audit(req, 'api.key.updated', { name: row.name, changes: Object.keys(patch) }, tenantId);
    return { key: publicKey(row) };
  });

  app.post<{ Params: { id: string } }>('/api/api-keys/:id/revoke', async (req) => {
    const { tenantId } = owner(req);
    const key = await ownKey(uuidParam(req.params.id), tenantId);
    if (!key) throw notFound();
    const [row] = await db.update(schema.apiKeys).set({ revokedAt: key.revokedAt ?? new Date() }).where(eq(schema.apiKeys.id, key.id)).returning();
    await audit(req, 'api.key.revoked', { name: row.name }, tenantId);
    return { key: publicKey(row) };
  });

  app.delete<{ Params: { id: string } }>('/api/api-keys/:id', async (req) => {
    const { tenantId } = owner(req);
    const key = await ownKey(uuidParam(req.params.id), tenantId);
    if (!key) throw notFound();
    await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, key.id));
    await audit(req, 'api.key.deleted', { name: key.name }, tenantId);
    return { ok: true };
  });

  // The audit trail of one key: every request, and the changes it made
  app.get<{ Params: { id: string } }>('/api/api-keys/:id/activity', async (req) => {
    const { tenantId } = owner(req);
    const key = await ownKey(uuidParam(req.params.id), tenantId);
    if (!key) throw notFound();
    const [requests, changes] = await Promise.all([
      db.query.apiRequests.findMany({ where: eq(schema.apiRequests.apiKeyId, key.id), orderBy: desc(schema.apiRequests.createdAt), limit: 200 }),
      db.query.auditLog.findMany({ where: eq(schema.auditLog.apiKeyId, key.id), orderBy: desc(schema.auditLog.createdAt), limit: 100 }),
    ]);
    return { requests, changes, keepDays: REQUEST_LOG_DAYS };
  });

  // ── Webhooks ─────────────────────────────────────────────────────────────
  app.get('/api/webhooks', async (req) => {
    const { tenantId, audience } = owner(req);
    const locale = requestLocale(req);
    const rows = await db.query.webhooks.findMany({
      where: tenantId ? eq(schema.webhooks.tenantId, tenantId) : isNull(schema.webhooks.tenantId),
      orderBy: desc(schema.webhooks.createdAt),
    });
    return {
      webhooks: rows.map(publicWebhook),
      events: Object.entries(webhookEvents[audience]).map(([name, text]) => ({ name, label: text[locale] })),
    };
  });

  const checkWebhook = (audience: Audience, body: { url?: string; events?: string[] }) => {
    if (body.url !== undefined) {
      const problem = webhookUrlProblem(body.url, audience);
      if (problem) throw badRequest(problem);
    }
    if (body.events !== undefined) {
      const known = new Set(Object.keys(webhookEvents[audience]));
      body.events = [...new Set(body.events)].filter((e) => known.has(e));
      if (!body.events.length) throw badRequest('errors.webhookEvents');
    }
  };

  app.post('/api/webhooks', async (req) => {
    const { tenantId, audience } = owner(req);
    const body = webhookInput.parse(req.body);
    checkWebhook(audience, body);
    const { webhook, secret } = await createWebhook(tenantId, body);
    await audit(req, 'webhook.created', { url: webhook.url }, tenantId);
    return { webhook: publicWebhook(webhook), secret };
  });

  app.put<{ Params: { id: string } }>('/api/webhooks/:id', async (req) => {
    const { tenantId, audience } = owner(req);
    const hook = await ownWebhook(req.params.id, tenantId);
    const body = sentOnly(webhookInput.partial().parse(req.body), req.body);
    checkWebhook(audience, body);
    // Switching a webhook back on gives it a clean slate
    const reactivated = body.active === true && !hook.active;
    const [row] = await db
      .update(schema.webhooks)
      .set({ ...body, ...(reactivated ? { failures: 0, disabledReason: null } : {}) })
      .where(eq(schema.webhooks.id, hook.id))
      .returning();
    await audit(req, 'webhook.updated', { url: row.url, changes: Object.keys(body) }, tenantId);
    return { webhook: publicWebhook(row) };
  });

  app.delete<{ Params: { id: string } }>('/api/webhooks/:id', async (req) => {
    const { tenantId } = owner(req);
    const hook = await ownWebhook(req.params.id, tenantId);
    await db.delete(schema.webhooks).where(eq(schema.webhooks.id, hook.id));
    await audit(req, 'webhook.deleted', { url: hook.url }, tenantId);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/webhooks/:id/secret', async (req) => {
    const { tenantId } = owner(req);
    return { secret: revealSecret(await ownWebhook(req.params.id, tenantId)) };
  });

  app.post<{ Params: { id: string } }>('/api/webhooks/:id/secret', async (req) => {
    const { tenantId } = owner(req);
    const hook = await ownWebhook(req.params.id, tenantId);
    const secret = newSecret();
    await db.update(schema.webhooks).set({ secret: encrypt(secret) }).where(eq(schema.webhooks.id, hook.id));
    await audit(req, 'webhook.secret_rotated', { url: hook.url }, tenantId);
    return { secret };
  });

  // Sends a "ping" right away, to check the address and the signature check on the other side
  app.post<{ Params: { id: string } }>('/api/webhooks/:id/test', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { tenantId } = owner(req);
    const hook = await ownWebhook(req.params.id, tenantId);
    const [delivery] = await db
      .insert(schema.webhookDeliveries)
      .values({ webhookId: hook.id, event: 'ping', payload: { event: 'ping', createdAt: new Date().toISOString(), tenantId, data: { webhookId: hook.id } }, nextAttemptAt: new Date() })
      .returning();
    // A test is sent once; it is not retried
    await db.update(schema.webhookDeliveries).set({ attempts: RETRY_DELAYS_MIN.length }).where(eq(schema.webhookDeliveries.id, delivery.id));
    return { delivery: await attempt(delivery.id) };
  });

  app.get<{ Params: { id: string } }>('/api/webhooks/:id/deliveries', async (req) => {
    const { tenantId } = owner(req);
    const hook = await ownWebhook(req.params.id, tenantId);
    return { deliveries: await db.query.webhookDeliveries.findMany({ where: eq(schema.webhookDeliveries.webhookId, hook.id), orderBy: desc(schema.webhookDeliveries.createdAt), limit: 100 }) };
  });

  app.post<{ Params: { id: string; deliveryId: string } }>('/api/webhooks/:id/deliveries/:deliveryId/retry', async (req) => {
    const { tenantId } = owner(req);
    const hook = await ownWebhook(req.params.id, tenantId);
    const delivery = await db.query.webhookDeliveries.findFirst({
      where: and(eq(schema.webhookDeliveries.id, uuidParam(req.params.deliveryId)), eq(schema.webhookDeliveries.webhookId, hook.id)),
    });
    if (!delivery) throw notFound();
    // A manual retry is one extra try, after which the delivery stays as it ends up
    await db.update(schema.webhookDeliveries).set({ status: 'pending', attempts: RETRY_DELAYS_MIN.length, nextAttemptAt: new Date() }).where(eq(schema.webhookDeliveries.id, delivery.id));
    return { delivery: await attempt(delivery.id) };
  });
}
