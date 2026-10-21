import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_SECRET ??= 'test-secret-test-secret';
const { base32Decode, base32Encode, hotp, newRecoveryCodes, normalizeRecoveryCode, otpauthUri, verifyTotp } = await import('../src/lib/totp.js');
const { isOfflineState } = await import('../src/services/consoles.js');
const { durationText } = await import('../src/services/monitoring.js');

// RFC 6238 appendix B: the SHA-1 secret is the ASCII string "12345678901234567890"
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

test('base32 round-trips and matches the RFC 4648 alphabet', () => {
  assert.equal(RFC_SECRET, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(base32Decode(RFC_SECRET).toString(), '12345678901234567890');
  assert.equal(base32Decode('gezd gnbv-gy3t qojq gezd gnbv gy3t qojq').toString(), '12345678901234567890');
});

test('codes match the RFC 6238 test vectors (last six digits)', () => {
  for (const [seconds, code] of [
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ] as const) {
    assert.equal(hotp(RFC_SECRET, Math.floor(seconds / 30)), code, String(seconds));
  }
});

test('a code is accepted one step either side, and never twice', () => {
  const now = 1_234_567_890_000;
  const step = Math.floor(now / 30_000);
  assert.equal(verifyTotp(RFC_SECRET, '005924', { now }), step);
  assert.equal(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), { now }), step - 1);
  assert.equal(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), { now }), step + 1);
  assert.equal(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 2), { now }), null);
  assert.equal(verifyTotp(RFC_SECRET, '005924', { now, lastStep: step }), null);
  assert.equal(verifyTotp(RFC_SECRET, '00592', { now }), null);
  assert.equal(verifyTotp(RFC_SECRET, '005 924', { now }), step);
});

test('recovery codes are unique, readable and forgiving to type', () => {
  const codes = newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  assert.equal(normalizeRecoveryCode(' abcd-ef23 '), 'ABCDEF23');
});

test('the otpauth link carries issuer, account and secret', () => {
  const uri = otpauthUri('ABC', 'sam@example.com', 'RHIS Captive Portal');
  assert.ok(uri.startsWith('otpauth://totp/RHIS%20Captive%20Portal%3Asam%40example.com?secret=ABC&issuer=RHIS%20Captive%20Portal'));
});

test('only real outages count as offline', () => {
  assert.ok(isOfflineState('OFFLINE'));
  assert.ok(isOfflineState('disconnected'));
  for (const s of ['ONLINE', 'UPDATING', 'PENDING_ADOPTION', '', null, undefined]) assert.ok(!isOfflineState(s), String(s));
});

test('outage durations read naturally', () => {
  assert.equal(durationText('en', 30_000), '1 min');
  assert.equal(durationText('en', 42 * 60_000), '42 min');
  assert.equal(durationText('nl', 125 * 60_000), '2 uur 5 min');
  assert.equal(durationText('en', 3 * 3600_000), '3 h');
  assert.equal(durationText('nl', 72 * 3600_000), '3 dagen');
});
