import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_SECRET ??= 'test-secret-test-secret';

// A tiny stand-in for the UniFi Network Integration API, reached through the Site Manager path
const calls: { method: string; url: string; key: string; body: unknown }[] = [];
const clients = Array.from({ length: 250 }, (_, i) => ({ id: `client-${i}`, macAddress: `aa:bb:cc:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}` }));

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://x');
  const raw = await readBody(req);
  calls.push({ method: req.method!, url: req.url!, key: String(req.headers['x-api-key']), body: raw ? JSON.parse(raw) : null });
  const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  if (req.headers['x-api-key'] !== 'good-key-123') return send(401, { message: 'unauthorized' });
  if (url.pathname === '/v1/hosts') return send(200, { data: [{ id: 'host-1', type: 'console', reportedState: { name: 'UDM Pro', hardware: { name: 'UniFi Dream Machine Pro' }, version: '4.3.6' } }] });
  const base = '/v1/connector/consoles/host-1/proxy/network/integration/v1';
  const page = <T>(items: T[]) => {
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 25);
    const data = items.slice(offset, offset + limit);
    return { offset, limit, count: data.length, totalCount: items.length, data };
  };
  if (url.pathname === `${base}/sites`) return send(200, page([{ id: 'site-uuid', internalReference: 'default', name: 'Default' }]));
  if (url.pathname === `${base}/sites/site-uuid/clients`) {
    // Behaves like an older version without filter support
    if (url.searchParams.has('filter')) return send(400, { message: 'unknown parameter filter' });
    return send(200, page(clients));
  }
  if (url.pathname === `${base}/sites/site-uuid/clients/client-249/actions` && req.method === 'POST') return send(200, { action: 'AUTHORIZE_GUEST_ACCESS' });
  return send(404, { message: 'not found' });
});

let unifi: typeof import('../src/services/unifi.js');
let target: import('../src/services/unifi.js').ConsoleTarget;

before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.UNIFI_SITE_MANAGER_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  unifi = await import('../src/services/unifi.js');
  target = { connection: 'site_manager', hostId: 'host-1', baseUrl: null, verifyTls: true, apiKey: 'good-key-123' };
});
after(() => server.close());

test('MAC addresses are normalised to lower case with colons', () => {
  assert.equal(unifi.normalizeMac('AA-BB-CC-11-22-33'), 'aa:bb:cc:11:22:33');
  assert.equal(unifi.normalizeMac('aabbcc112233'), 'aa:bb:cc:11:22:33');
});

test('Site Manager consoles are listed with a readable name', async () => {
  const hosts = await unifi.listSiteManagerHosts('good-key-123');
  assert.deepEqual(hosts, [{ id: 'host-1', name: 'UDM Pro', model: 'UniFi Dream Machine Pro', version: '4.3.6' }]);
});

test('a rejected API key gives a clear error', async () => {
  await assert.rejects(unifi.listSites({ ...target, apiKey: 'wrong-key-000' }), /API key rejected \(401\)/);
});

test('clients are found across pages when the console does not support filters', async () => {
  const client = await unifi.findClient(target, 'site-uuid', 'AA:BB:CC:00:00:F9');
  assert.equal(client?.id, 'client-249');
  assert.ok(calls.some((c) => c.url.includes('offset=200')), 'second page fetched');
});

test('authorizing a guest sends the limits in UniFi terms', async () => {
  await unifi.authorizeGuest(target, 'site-uuid', 'client-249', { timeLimitMinutes: 60, dataLimitMb: 500, downKbps: 10000, upKbps: 2000 });
  const call = calls.at(-1)!;
  assert.equal(call.method, 'POST');
  assert.deepEqual(call.body, { action: 'AUTHORIZE_GUEST_ACCESS', timeLimitMinutes: 60, dataUsageLimitMBytes: 500, rxRateLimitKbps: 10000, txRateLimitKbps: 2000 });
});
