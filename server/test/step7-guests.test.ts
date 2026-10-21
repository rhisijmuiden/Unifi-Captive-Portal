import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_SECRET ??= 'test-secret-test-secret';
const { maskPhone, normalizePhone } = await import('../src/services/sms.js');
const { normalizeRoom, parseStayDate, parseStaysCsv, roomFailed, roomLocked, surnameKey, surnameMatches, zonedTime } = await import('../src/services/hotel.js');
const { appleClientSecret, decodeIdToken } = await import('../src/services/socialLogin.js');
const { renderLoginBlock } = await import('../src/shared/portalDesign.js');

test('phone numbers become E.164', () => {
  assert.equal(normalizePhone('06 12 34 56 78', '31'), '+31612345678');
  assert.equal(normalizePhone('+31 (0)6-1234 5678', '31'), '+31612345678');
  assert.equal(normalizePhone('0031612345678', '31'), '+31612345678');
  assert.equal(normalizePhone('0470 12 34 56', '32'), '+32470123456');
  assert.equal(normalizePhone('+44 7700 900123', '31'), '+447700900123');
  assert.equal(normalizePhone('12', '31'), null);
  assert.equal(normalizePhone('hello', '31'), null);
  assert.equal(maskPhone('+31612345678'), '+31\u00a0••••\u00a05678');
});

test('rooms and surnames match the way guests type them', () => {
  assert.equal(normalizeRoom(' 012 '), '12');
  assert.equal(normalizeRoom('b 3'), 'B3');
  assert.equal(surnameKey('Van der Berg-Öztürk'), 'vanderbergozturk');
  assert.ok(surnameMatches('van den Berg', 'Van Den Berg'));
  assert.ok(surnameMatches('van den Berg', 'berg'));
  assert.ok(surnameMatches('Müller', 'muller'));
  assert.ok(surnameMatches('Müller', 'Mueller'));
  assert.ok(surnameMatches('Mueller', 'Mueller'));
  assert.ok(surnameMatches('Vandenberg', 'berg'));
  assert.ok(!surnameMatches('Jansen', 'Janssen'));
  assert.ok(!surnameMatches('de Vries', 'de'));
  assert.ok(!surnameMatches('Smit', ''));
});

test('a room locks after five wrong surnames', () => {
  const now = Date.now();
  for (let i = 0; i < 4; i++) roomFailed('t1', '101', now);
  assert.ok(!roomLocked('t1', '101', now));
  roomFailed('t1', '0101', now);
  assert.ok(roomLocked('t1', '101', now));
  assert.ok(!roomLocked('t1', '102', now));
  assert.ok(!roomLocked('t1', '101', now + 16 * 60_000));
});

test('local dates and times follow the time zone, also across DST', () => {
  assert.equal(zonedTime('2026-07-01', '12:00', 'Europe/Amsterdam').toISOString(), '2026-07-01T10:00:00.000Z');
  assert.equal(zonedTime('2026-12-01', '12:00', 'Europe/Amsterdam').toISOString(), '2026-12-01T11:00:00.000Z');
  assert.equal(parseStayDate('21-10-2026', '11:00', 'Europe/Amsterdam')?.toISOString(), '2026-10-21T09:00:00.000Z');
  assert.equal(parseStayDate('2026-10-21 15:30', '11:00', 'Europe/Amsterdam')?.toISOString(), '2026-10-21T13:30:00.000Z');
  assert.equal(parseStayDate('2026-10-21T15:30:00Z', '11:00')?.toISOString(), '2026-10-21T15:30:00.000Z');
  assert.equal(parseStayDate('2026-13-01', '11:00'), null);
  assert.equal(parseStayDate('tomorrow', '11:00'), null);
});

test('CSV exports are read with or without a header', () => {
  const withHeader = parseStaysCsv('Achternaam;Kamer;Vertrek;Aankomst\n"de Vries";101;23-10-2026;20-10-2026\nJansen;;23-10-2026;20-10-2026\n', '11:00', 'Europe/Amsterdam');
  assert.equal(withHeader.stays.length, 1);
  assert.deepEqual({ room: withHeader.stays[0].room, surname: withHeader.stays[0].surname }, { room: '101', surname: 'de Vries' });
  assert.equal(withHeader.stays[0].departure.toISOString(), '2026-10-23T09:00:00.000Z');
  assert.deepEqual(withHeader.errors, [{ line: 3, reason: 'missing' }]);
  const plain = parseStaysCsv('12,Smit,2026-10-20,2026-10-22\n14,Bakker,2026-10-22,2026-10-20', '12:00', 'Europe/Amsterdam');
  assert.equal(plain.stays.length, 1);
  assert.deepEqual(plain.errors, [{ line: 2, reason: 'order' }]);
});

test('the Apple client secret is an ES256 JWT that verifies with the key', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const jwt = appleClientSecret({ appleServiceId: 'nl.example.wifi', appleTeamId: 'ABCDE12345', appleKeyId: 'KEY1234567', applePrivateKey: pem }, 1_800_000_000_000);
  const [h, p, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url').toString()), { iss: 'ABCDE12345', iat: 1_800_000_000, exp: 1_800_000_600, aud: 'https://appleid.apple.com', sub: 'nl.example.wifi' });
  assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
  assert.throws(() => appleClientSecret({ appleServiceId: 'x', appleTeamId: 'x', appleKeyId: 'x', applePrivateKey: 'not a key' }));
});

test('ID token claims are read', () => {
  const token = ['e30', Buffer.from(JSON.stringify({ sub: '1', email: 'a@b.nl', name: 'Sam' })).toString('base64url'), 'sig'].join('.');
  assert.deepEqual(decodeIdToken(token), { sub: '1', email: 'a@b.nl', name: 'Sam' });
});

const ctx = (login: Record<string, unknown>) => ({
  locale: 'en' as const,
  fallbackLocale: 'en',
  languages: [],
  login: { methods: [], requireTerms: false, terms: '', emailFields: { name: 'off', phone: 'off', marketing: false }, paymentEmail: 'off', packages: [], action: '/x', ...login },
});

test('social sign-ins share one tab with a button each', () => {
  const html = renderLoginBlock(ctx({ methods: ['free', 'facebook', 'google', 'apple', 'microsoft'] }) as never);
  assert.equal((html.match(/class="cp-tab-r"/g) ?? []).length, 2);
  assert.match(html, /<label for="cp-m-social">Account<\/label>/);
  for (const m of ['google', 'apple', 'microsoft', 'facebook']) assert.match(html, new RegExp(`name="method" value="${m}"`));
  const one = renderLoginBlock(ctx({ methods: ['free', 'google'] }) as never);
  assert.match(one, /<label for="cp-m-social">Google<\/label>/);
});

test('the SMS form asks for the code once it was sent', () => {
  const first = renderLoginBlock(ctx({ methods: ['sms'], smsCountry: '31' }) as never);
  assert.match(first, /name="phone"/);
  assert.match(first, /placeholder="\+31 …"/);
  const second = renderLoginBlock(ctx({ methods: ['sms'], active: 'sms', values: { phone: '+31612345678' }, smsSent: { masked: '+31 •••• 5678', canResend: true } }) as never);
  assert.match(second, /name="code"/);
  assert.match(second, /\+31 •••• 5678/);
  assert.match(second, /name="resend"/);
  assert.match(second, /type="hidden" name="phone" value="\+31612345678"/);
});

test('a partial update keeps the fields it does not mention', async () => {
  const { z } = await import('zod');
  const { sentOnly } = await import('../src/lib/patch.js');
  const schema = z.object({ a: z.number().default(5), b: z.string().default('x') });
  assert.deepEqual(sentOnly(schema.partial().parse({ b: 'y' }), { b: 'y' }), { b: 'y' });
});
