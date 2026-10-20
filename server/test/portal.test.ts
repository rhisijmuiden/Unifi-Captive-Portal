import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_SECRET ??= 'test-secret-test-secret';
const { isValidHostname, normalizeHostname } = await import('../src/lib/hostname.js');
const { renderLogin, renderMessage } = await import('../src/views/portal.js');

test('customer hostnames are validated', () => {
  assert.equal(normalizeHostname(' Gast.Bedrijf.NL. '), 'gast.bedrijf.nl');
  for (const ok of ['gast.bedrijf.nl', 'wifi.guest.example.com', 'a1-b2.example.io']) assert.ok(isValidHostname(ok), ok);
  for (const bad of ['localhost', '-gast.bedrijf.nl', 'gast-.bedrijf.nl', 'gast..nl', '192.168.1.1', 'gast bedrijf.nl', 'http://x.nl']) {
    assert.ok(!isValidHostname(bad), bad);
  }
});

test('the guest page escapes customer texts and shows the terms checkbox', () => {
  const html = renderLogin({
    locale: 'nl',
    accent: '#123456',
    title: '<script>alert(1)</script>',
    welcome: 'Hallo\n\nTweede alinea',
    terms: 'Regel 1',
    requireTerms: true,
    action: '/portal/abc/connect',
    path: '/portal/abc',
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<p>Tweede alinea</p>'));
  assert.ok(html.includes('name="terms"'));
  assert.ok(html.includes('Ik ga akkoord met de voorwaarden'));
  assert.ok(html.includes('--accent:#123456'));
  assert.ok(html.includes('href="https://rhis.nl"'));
});

test('guest pages are available in every language and link to the others', () => {
  const html = renderMessage('en', 'Title', 'Body', { path: '/portal/abc' });
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(html.includes('href="/portal/abc?lang=nl"'));
});
