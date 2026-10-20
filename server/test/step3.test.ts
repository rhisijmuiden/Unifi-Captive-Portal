import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_SECRET ??= 'test-secret-test-secret';
const { formatCode, generateCode, normalizeCode } = await import('../src/services/vouchers.js');
const { verifyStripeSignature } = await import('../src/services/payments.js');
const { fillHtml, fillPlain, renderMail, defaultMailTheme } = await import('../src/shared/mailDesign.js');
const { previousMonth, shiftMonth } = await import('../src/services/reports.js');
const { durationLabel, guestStrings, moneyLabel } = await import('../src/shared/guestStrings.js');

test('voucher codes are readable and forgiving to type', () => {
  for (let i = 0; i < 200; i++) {
    const code = generateCode();
    assert.match(code, /^[0-9A-Z]{8}$/);
    assert.ok(!/[01IO]/.test(code), code);
  }
  assert.equal(formatCode('ABCD2345'), 'ABCD-2345');
  assert.equal(normalizeCode(' abcd-2345 '), 'ABCD2345');
});

test('Stripe webhooks need a fresh, valid signature', () => {
  const secret = 'whsec_test';
  const body = '{"id":"evt_1"}';
  const now = 1_760_000_000_000;
  const t = Math.floor(now / 1000);
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  assert.ok(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, now));
  assert.ok(!verifyStripeSignature(body + ' ', `t=${t},v1=${sig}`, secret, now));
  assert.ok(!verifyStripeSignature(body, `t=${t},v1=${sig}`, 'other', now));
  assert.ok(!verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, now + 10 * 60_000));
  assert.ok(!verifyStripeSignature(body, undefined, secret, now));
});

test('mail templates escape variables and keep the RHIS footer', () => {
  assert.equal(fillHtml('<p>{{name}}</p>', { name: '<b>x</b>' }), '<p>&lt;b&gt;x&lt;/b&gt;</p>');
  assert.equal(fillHtml('{{{data}}}', {}, { data: '<table></table>' }), '<table></table>');
  assert.equal(fillHtml('{{{name}}}', { name: '<i>' }), '&lt;i&gt;');
  assert.equal(fillPlain('Hoi {{ name }}', { name: 'Sam' }), 'Hoi Sam');
  const html = renderMail({ subject: 'Hi {{name}}\r\nBcc: x', mode: 'html', html: '<p>{{name}}</p>', design: { version: 1, theme: defaultMailTheme, blocks: [] } }, { vars: { name: 'Sam' }, baseUrl: 'https://x', locale: 'en' });
  assert.equal(html.subject, 'Hi Sam Bcc: x');
  assert.ok(html.html.includes('Designed by'));
  const visual = renderMail(
    { subject: 's', mode: 'visual', html: '', design: { version: 1, theme: defaultMailTheme, blocks: [{ id: 'a', type: 'heading', text: 'Hello {{name}}' }, { id: 'b', type: 'button', label: 'Go', url: 'javascript:alert(1)' }] } as never },
    { vars: { name: '<Sam>' }, baseUrl: 'https://x', locale: 'en' },
  );
  assert.ok(visual.html.includes('Hello &lt;Sam&gt;'));
  assert.ok(!visual.html.includes('javascript:'));
  assert.ok(visual.html.includes('Designed by'));
});

test('report months roll over the year', () => {
  assert.equal(previousMonth(new Date('2026-01-15T12:00:00Z')), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-03', -3), '2025-12');
});

test('guest labels for time and money follow the language', () => {
  assert.equal(durationLabel(guestStrings.en, 1440), guestStrings.en.durationDay);
  assert.equal(durationLabel(guestStrings.nl, 120), guestStrings.nl.durationHours.replace('{{n}}', '2'));
  assert.ok(moneyLabel('nl', 495, 'EUR').includes('4,95'));
  assert.ok(moneyLabel('en', 495, 'EUR').includes('4.95'));
});
