import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_SECRET ??= 'test-secret-test-secret';
const { operations, findOperation, hasScope, requiredScope, publicPath, scopeList } = await import('../src/api/catalog.js');
const { buildOpenApi } = await import('../src/api/openapi.js');
const { cleanScopes, takeRequest } = await import('../src/services/apiKeys.js');
const { isPrivateAddress, sign, webhookUrlProblem } = await import('../src/services/webhooks.js');
const { buildApp } = await import('../src/app.js');

test('every API operation is a real route, and key management is not part of the API', async () => {
  const app = await buildApp();
  for (const op of operations) assert.ok(app.hasRoute({ method: op.method, url: op.route }), `${op.method} ${op.route}`);
  for (const route of ['/api/api-keys', '/api/webhooks', '/api/auth/login', '/api/auth/password']) {
    assert.equal(findOperation('GET', route) ?? findOperation('POST', route), undefined, route);
  }
  // Restoring a backup wipes the database; it stays in the web interface
  assert.equal(findOperation('POST', '/api/backups/targets/:id/sets/:setId/restore'), undefined);
  await app.close();
});

test('customer keys never reach platform operations and the other way round', () => {
  const tenants = findOperation('POST', '/api/tenants')!;
  assert.equal(requiredScope(tenants, 'tenant'), null);
  assert.equal(requiredScope(tenants, 'platform'), 'tenants:write');
  const consoles = findOperation('GET', '/api/consoles')!;
  assert.equal(requiredScope(consoles, 'platform'), null);
  assert.equal(requiredScope(consoles, 'tenant'), 'consoles:read');
  // Every operation is open to at least one kind of key, with a scope that exists
  for (const op of operations) {
    const audiences = (['tenant', 'platform'] as const).filter((a) => requiredScope(op, a));
    assert.ok(audiences.length, `${op.method} ${op.route}`);
    for (const a of audiences) assert.ok(scopeList(a).includes(requiredScope(op, a)!), `${op.method} ${op.route} ${a}`);
  }
});

test('write scopes include read, not the other way round', () => {
  assert.ok(hasScope(['vouchers:write'], 'vouchers:read'));
  assert.ok(hasScope(['vouchers:read'], 'vouchers:read'));
  assert.ok(!hasScope(['vouchers:read'], 'vouchers:write'));
  assert.ok(!hasScope(['guests:write'], 'vouchers:read'));
});

test('unknown scopes and scopes of the other kind of key are dropped', () => {
  assert.deepEqual(cleanScopes('tenant', ['vouchers:write', 'tenants:write', 'nope', 'vouchers:write', 'guests:read']), ['guests:read', 'vouchers:write']);
  assert.deepEqual(cleanScopes('platform', ['tenants:read', 'consoles:read']), ['tenants:read']);
});

test('public paths use /api/v1 and OpenAPI path parameters', () => {
  assert.equal(publicPath('/api/consoles/:id/sync'), '/api/v1/consoles/{id}/sync');
  assert.equal(publicPath('/api/billing/customers/:tenantId'), '/api/v1/billing/customers/{tenantId}');
});

test('the OpenAPI description builds for both APIs in both languages', () => {
  for (const audience of ['tenant', 'platform'] as const) {
    for (const locale of ['en', 'nl'] as const) {
      const spec = buildOpenApi(audience, locale, 'https://portal.example.com');
      assert.equal(spec.openapi, '3.1.0');
      assert.equal(spec.servers[0].url, 'https://portal.example.com');
      const ids = Object.values(spec.paths).flatMap((p) => Object.values(p).map((o) => (o as { operationId: string }).operationId));
      assert.equal(new Set(ids).size, ids.length, 'operation ids are unique');
      assert.ok(Object.keys(spec.webhooks).length > 0);
    }
  }
  const nl = buildOpenApi('tenant', 'nl');
  assert.equal((nl.paths['/api/v1/vouchers'].post as { summary: string }).summary, 'Vouchers aanmaken');
  const body = (nl.paths['/api/v1/vouchers'].post as { requestBody: { content: { 'application/json': { schema: { properties: Record<string, unknown> } } } } }).requestBody;
  assert.ok('durationMinutes' in body.content['application/json'].schema.properties);
});

test('rate limits count per key per minute', () => {
  const t0 = Date.UTC(2026, 9, 21, 12, 0, 0);
  assert.equal(takeRequest('k1', 2, t0).allowed, true);
  assert.equal(takeRequest('k1', 2, t0 + 1000).remaining, 0);
  const over = takeRequest('k1', 2, t0 + 2000);
  assert.equal(over.allowed, false);
  assert.equal(over.reset, 58);
  assert.equal(takeRequest('k2', 2, t0 + 2000).allowed, true);
  assert.equal(takeRequest('k1', 2, t0 + 60_000).allowed, true);
});

test('webhook signatures are an HMAC of timestamp and body', () => {
  const body = '{"event":"ping"}';
  const expected = createHmac('sha256', 'whsec_x').update(`1700000000.${body}`).digest('hex');
  assert.equal(sign('whsec_x', 1700000000, body), `v1=${expected}`);
});

test('customer webhooks cannot call private addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0']) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.ok(!isPrivateAddress(ip), ip);
  assert.equal(webhookUrlProblem('https://hooks.example.com/in', 'tenant'), null);
  assert.equal(webhookUrlProblem('http://hooks.example.com/in', 'tenant'), 'errors.webhookHttps');
  assert.equal(webhookUrlProblem('https://192.168.1.10/in', 'tenant'), 'errors.webhookPrivate');
  assert.equal(webhookUrlProblem('https://[::1]/in', 'tenant'), 'errors.webhookPrivate');
  assert.equal(webhookUrlProblem('https://localhost/in', 'tenant'), 'errors.webhookPrivate');
  assert.equal(webhookUrlProblem('https://user:pw@example.com/', 'tenant'), 'errors.webhookUrl');
  assert.equal(webhookUrlProblem('ftp://example.com/', 'platform'), 'errors.webhookUrl');
  // The platform's own webhooks may call the local network, e.g. an internal monitoring system
  assert.equal(webhookUrlProblem('http://10.0.0.5:9000/in', 'platform'), null);
});
