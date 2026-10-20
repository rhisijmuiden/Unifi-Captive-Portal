import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_SECRET ??= 'test-secret-test-secret';
const { isValidHostname, normalizeHostname } = await import('../src/lib/hostname.js');
const { renderGuestPage, renderMessage } = await import('../src/views/portal.js');
const { defaultDesign, portalTemplates } = await import('../src/shared/portalTemplates.js');
const { portalDesignSchema } = await import('../src/services/portalDesign.js');
type LoginContext = import('../src/shared/portalDesign.js').LoginContext;

test('customer hostnames are validated', () => {
  assert.equal(normalizeHostname(' Gast.Bedrijf.NL. '), 'gast.bedrijf.nl');
  for (const ok of ['gast.bedrijf.nl', 'wifi.guest.example.com', 'a1-b2.example.io']) assert.ok(isValidHostname(ok), ok);
  for (const bad of ['localhost', '-gast.bedrijf.nl', 'gast-.bedrijf.nl', 'gast..nl', '192.168.1.1', 'gast bedrijf.nl', 'http://x.nl']) {
    assert.ok(!isValidHostname(bad), bad);
  }
});

const login = (extra: Partial<LoginContext> = {}): LoginContext => ({
  methods: ['free'],
  requireTerms: true,
  terms: 'Regel 1',
  emailFields: { name: 'off', phone: 'off', marketing: false },
  paymentEmail: 'off',
  packages: [],
  action: '/portal/abc/connect',
  ...extra,
});

test('the guest page escapes customer texts and shows the terms checkbox', () => {
  const design = defaultDesign();
  design.theme.accent = '#123456';
  design.blocks = design.blocks.map((b) => (b.type === 'heading' ? { ...b, text: { nl: '<script>alert(1)</script>' } } : b.type === 'text' ? { ...b, text: { nl: 'Hallo\n\nTweede alinea' } } : b));
  const html = renderGuestPage({ locale: 'nl', design, title: 'Wifi', path: '/portal/abc', login: login() });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<p>Tweede alinea</p>'));
  assert.ok(html.includes('name="terms"'));
  assert.ok(html.includes('Ik ga akkoord met de voorwaarden'));
  assert.ok(html.includes('#123456'));
  assert.ok(html.includes('Designed by'));
});

test('the guest page shows a tab per sign-in method, Facebook included', () => {
  const html = renderGuestPage({ locale: 'en', title: 'Wifi', path: '/portal/abc', login: login({ methods: ['free', 'voucher', 'facebook'] }) });
  assert.ok(html.includes('cp-tabs'));
  assert.ok(html.includes('value="voucher"'));
  assert.ok(html.includes('value="facebook"'));
  assert.ok(html.includes('Continue with Facebook'));
  const single = renderGuestPage({ locale: 'en', title: 'Wifi', path: '/portal/abc', login: login() });
  assert.ok(!single.includes('class="cp-tabs'));
});

test('every template is a valid design with exactly one sign-in block', () => {
  for (const tpl of portalTemplates) {
    assert.ok(portalDesignSchema.safeParse(tpl.design).success, tpl.id);
    assert.equal(tpl.design.blocks.filter((b) => b.type === 'login').length, 1, tpl.id);
  }
  const noLogin = { ...defaultDesign(), blocks: defaultDesign().blocks.filter((b) => b.type !== 'login') };
  assert.ok(!portalDesignSchema.safeParse(noLogin).success);
});

test('guest pages are available in every language and link to the others', () => {
  const html = renderMessage('en', 'Title', 'Body', { path: '/portal/abc' });
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(html.includes('href="/portal/abc?lang=nl"'));
});
