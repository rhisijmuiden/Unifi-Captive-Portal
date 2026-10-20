import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_SECRET ??= 'test-secret-test-secret';
const { decrypt, encrypt, hashPassword, verifyPassword } = await import('../src/lib/crypto.js');

test('secrets round-trip through AES-GCM and are not stored in plain text', () => {
  const enc = encrypt('smtp-wachtwoord');
  assert.ok(!enc.includes('smtp-wachtwoord'));
  assert.notEqual(enc, encrypt('smtp-wachtwoord'));
  assert.equal(decrypt(enc), 'smtp-wachtwoord');
});

test('password hashes verify only the right password', async () => {
  const h = await hashPassword('correct horse battery');
  assert.equal(await verifyPassword(h, 'correct horse battery'), true);
  assert.equal(await verifyPassword(h, 'wrong'), false);
});
