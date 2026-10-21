import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit, requireSuperadmin, tenantScope } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import {
  adminHostnames,
  caddyStatus,
  checkDns,
  checkHostname,
  clearHostnameCache,
  isValidHostname,
  mayIssueCertificate,
  normalizeHostname,
  probeTls,
} from '../services/hostnames.js';
import { getPublicSettings, getSettings } from '../services/settings.js';
import { resellerHostnames } from '../services/resellers.js';

const isLoopback = (ip: string | undefined) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

export async function hostnameRoutes(app: FastifyInstance) {
  // Called by Caddy before it requests a certificate; only from Caddy itself, never proxied
  app.get<{ Querystring: { domain?: string } }>('/api/caddy/ask', async (req, reply) => {
    if (!isLoopback(req.socket.remoteAddress) || req.headers['x-forwarded-for']) return reply.code(403).send();
    const ok = req.query.domain ? await mayIssueCertificate(req.query.domain) : false;
    return reply.code(ok ? 200 : 404).send(ok ? 'ok' : 'unknown');
  });

  app.get('/api/hostnames', async (req) => {
    const tenantId = tenantScope(req);
    const [rows, hosting] = await Promise.all([
      db.query.hostnames.findMany({ where: eq(schema.hostnames.tenantId, tenantId), orderBy: asc(schema.hostnames.createdAt) }),
      getSettings('hosting'),
    ]);
    // Customers need the server address for their DNS records
    return { hostnames: rows, target: { ipv4: hosting.publicIpv4 || null, ipv6: hosting.publicIpv6 || null } };
  });

  app.post('/api/hostnames', async (req) => {
    const body = z.object({ hostname: z.string().min(1).max(253) }).parse(req.body);
    const tenantId = tenantScope(req, true);
    const hostname = normalizeHostname(body.hostname);
    if (!isValidHostname(hostname)) throw badRequest('errors.hostnameFormat');
    if ((await adminHostnames()).has(hostname) || (await resellerHostnames()).has(hostname)) throw badRequest('errors.hostnameReserved');
    if (await db.query.hostnames.findFirst({ where: eq(schema.hostnames.hostname, hostname) })) throw badRequest('errors.hostnameTaken');
    const [row] = await db.insert(schema.hostnames).values({ tenantId, hostname }).returning();
    await audit(req, 'hostname.created', { hostname }, tenantId);
    clearHostnameCache();
    // The DNS record is often already in place; check right away, but don't wait for the certificate
    void checkHostname(row).catch((err) => req.log.error(err));
    return { hostname: row };
  });

  app.post<{ Params: { id: string } }>('/api/hostnames/:id/check', async (req) => {
    const tenantId = tenantScope(req, true);
    const row = await db.query.hostnames.findFirst({ where: and(eq(schema.hostnames.id, req.params.id), eq(schema.hostnames.tenantId, tenantId)) });
    if (!row) throw notFound();
    const updated = await checkHostname(row);
    clearHostnameCache();
    return { hostname: updated };
  });

  app.delete<{ Params: { id: string } }>('/api/hostnames/:id', async (req) => {
    const tenantId = tenantScope(req, true);
    const [row] = await db
      .delete(schema.hostnames)
      .where(and(eq(schema.hostnames.id, req.params.id), eq(schema.hostnames.tenantId, tenantId)))
      .returning();
    if (!row) throw notFound();
    await audit(req, 'hostname.deleted', { hostname: row.hostname }, tenantId);
    clearHostnameCache();
    return { ok: true };
  });

  // ── Platform hosting (superadmin) ─────────────────────────────────────────

  app.post('/api/settings/hosting/detect-ip', async (req) => {
    requireSuperadmin(req);
    const lookup = async (url: string) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        return res.ok ? (await res.text()).trim() : '';
      } catch {
        return '';
      }
    };
    const [ipv4, ipv6] = await Promise.all([lookup('https://api.ipify.org'), lookup('https://api6.ipify.org')]);
    if (!ipv4 && !ipv6) throw badRequest('errors.ipDetectFailed', { reason: 'api.ipify.org' });
    return { ipv4: z.ipv4().safeParse(ipv4).success ? ipv4 : '', ipv6: z.ipv6().safeParse(ipv6).success ? ipv6 : '' };
  });

  // Checks the admin hostname the same way as customer hostnames
  app.post('/api/settings/hosting/check', async (req) => {
    requireSuperadmin(req);
    const { adminHostname } = await getSettings('hosting');
    if (!adminHostname) throw badRequest('errors.hostnameFormat');
    let result = await checkDns(adminHostname);
    if (result.status === 'dns_ok') result = await probeTls(adminHostname);
    return { ...result, settings: await getPublicSettings('hosting') };
  });

  app.get('/api/settings/hosting/caddy', async (req) => {
    requireSuperadmin(req);
    return caddyStatus();
  });
}
