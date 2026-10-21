import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_SECRET ??= 'test-secret-test-secret';
const { renderGuestPage, renderMessage } = await import('../src/views/portal.js');
const { renderMail, defaultMailTheme } = await import('../src/shared/mailDesign.js');
const { resellerInput } = await import('../src/routes/resellers.js');

const login = {
  methods: ['free'],
  requireTerms: false,
  terms: '',
  emailFields: { name: 'off', phone: 'off', marketing: false },
  paymentEmail: 'off',
  packages: [],
  action: '/portal/abc/connect',
} as never;

test('a reseller can leave "Designed by RHIS" off its customers\' guest pages', () => {
  const page = { locale: 'en' as const, title: 'Wifi', path: '/portal/abc', login, privacyHref: '/portal/privacy/x' };
  assert.ok(renderGuestPage(page).includes('Designed by'));
  const without = renderGuestPage({ ...page, designedBy: false });
  assert.ok(!without.includes('Designed by'));
  // The privacy link stays
  assert.ok(without.includes('/portal/privacy/x'));
  assert.ok(!renderMessage('en', 'Done', 'You are online', { designedBy: false }).includes('Designed by'));
});

test('a reseller can leave "Designed by RHIS" off its customers\' e-mails', () => {
  const design = { version: 1, theme: defaultMailTheme, blocks: [{ id: 'a', type: 'heading', text: 'Hello' }] } as never;
  for (const mode of ['visual', 'html'] as const) {
    const content = { subject: 's', mode, html: '<p>Hi</p>', design };
    const input = { vars: {}, baseUrl: 'https://x', locale: 'en' as const };
    assert.ok(renderMail(content, input).html.includes('Designed by'), mode);
    const off = renderMail(content, { ...input, designedBy: false });
    assert.ok(!off.html.includes('Designed by'), mode);
    assert.ok(!off.text.includes('Designed by'), mode);
  }
});

test('reseller input keeps "Powered by RHIS" on and "Designed by RHIS" off by default', () => {
  const r = resellerInput.parse({ name: 'Partner', slug: 'partner', brandName: 'Partner', adminHostname: 'Beheer.Partner.NL.' });
  assert.equal(r.showPoweredBy, true);
  assert.equal(r.showDesignedBy, false);
  assert.equal(r.adminHostname, 'beheer.partner.nl');
  assert.equal(resellerInput.safeParse({ name: 'P', slug: 'p', brandName: 'P', accentColor: 'red' }).success, false);
  assert.equal(resellerInput.safeParse({ name: 'P', slug: 'p', brandName: 'P', logoUrl: 'https://evil.example/logo.png' }).success, false);
  assert.equal(resellerInput.parse({ name: 'P', slug: 'p', brandName: 'P', websiteUrl: '' }).websiteUrl, null);
});
