import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { config } from './config.js';
import { loadUser } from './lib/auth.js';
import { HttpError } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { settingsRoutes } from './routes/settings.js';
import { systemRoutes } from './routes/system.js';
import { tenantRoutes } from './routes/tenants.js';
import { userRoutes } from './routes/users.js';

const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp() {
  const app = Fastify({
    trustProxy: true,
    logger: config.isDev ? { transport: { target: 'pino-pretty' } } : { level: 'info' },
  });

  await app.register(cookie, { secret: config.appSecret });
  await app.register(rateLimit, { global: false });

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    // A custom header cannot be sent cross-site without a CORS preflight, which we never allow
    if (MUTATING.has(req.method) && req.headers['x-requested-with'] !== 'captive-portal') {
      return reply.code(403).send({ error: 'Ongeldige aanvraag' });
    }
    req.user = await loadUser(req);
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: err.issues[0]?.message ?? 'Ongeldige invoer', issues: err.issues });
    }
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? 'Er ging iets mis op de server' : (err as Error).message });
  });

  await app.register(authRoutes);
  await app.register(tenantRoutes);
  await app.register(userRoutes);
  await app.register(settingsRoutes);
  await app.register(systemRoutes);

  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.method !== 'GET' || !existsSync(webDist)) {
      return reply.code(404).send({ error: 'Niet gevonden' });
    }
    return reply.sendFile('index.html');
  });

  return app;
}
