import type { FastifyReply, FastifyRequest } from 'fastify';
import { requestLocale, t, type MessageKey } from '../i18n/index.js';
import { audienceOf, authenticateKey, logRequest, takeRequest } from '../services/apiKeys.js';
import { findOperation, hasScope, requiredScope } from './catalog.js';

export const API_V1 = /^\/api\/v1\//;
/** Routes under /api/v1 that need no key (the API description itself) */
const OPEN = new Set(['/api/openapi.json']);
/** Failed key attempts per address per minute before they are refused outright */
const FAILED_PER_MINUTE = 30;

export const isApiV1 = (req: FastifyRequest) => API_V1.test(req.originalUrl);

const reasons: Record<string, MessageKey> = {
  invalid: 'errors.apiKeyInvalid',
  expired: 'errors.apiKeyExpired',
  revoked: 'errors.apiKeyRevoked',
  suspended: 'errors.apiKeySuspended',
};

/**
 * Lets an /api/v1 request through when its key is valid, within its rate limit and has the
 * scope for the operation. The route itself then runs as for an admin of the key's customer
 * (or a platform admin), so the same checks and validation apply as in the interface.
 */
export async function apiKeyGate(req: FastifyRequest, reply: FastifyReply) {
  const locale = requestLocale(req);
  const route = req.routeOptions.url;
  if (route && OPEN.has(route)) return;
  const fail = (code: number, key: MessageKey, params?: Record<string, string | number>) => reply.code(code).send({ error: t(locale, key, params) });

  const auth = await authenticateKey(req.headers.authorization);
  if (!auth.ok) {
    const limit = takeRequest(`ip:${req.ip}`, FAILED_PER_MINUTE);
    if (!limit.allowed) return reply.header('retry-after', limit.reset).code(429).send({ error: t(locale, 'errors.apiRateLimit', { seconds: limit.reset }) });
    return fail(401, reasons[auth.reason]);
  }
  req.apiKey = auth.key;
  req.user = auth.user;

  const limit = takeRequest(auth.key.id, auth.key.rateLimit);
  reply.header('x-ratelimit-limit', limit.limit).header('x-ratelimit-remaining', limit.remaining).header('x-ratelimit-reset', limit.reset);
  if (!limit.allowed) return reply.header('retry-after', limit.reset).code(429).send({ error: t(locale, 'errors.apiRateLimit', { seconds: limit.reset }) });

  const op = findOperation(req.method, route);
  const scope = op && requiredScope(op, audienceOf(auth.key));
  if (!scope) return fail(404, 'errors.apiNotAvailable');
  if (!hasScope(auth.key.scopes, scope)) return fail(403, 'errors.apiScope', { scope });
}

export async function logApiRequest(req: FastifyRequest, reply: FastifyReply) {
  await logRequest(req.apiKey!, {
    method: req.method,
    path: req.originalUrl.split('?')[0],
    status: reply.statusCode,
    durationMs: Math.round(reply.elapsedTime),
    ip: req.ip,
  });
}
