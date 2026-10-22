import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_SECRET ??= 'test-secret-test-secret';
const { generatePassword, hashPassword, verifyPassword } = await import('../src/lib/crypto.js');
const { adminInput } = await import('../src/routes/tenants.js');
const { userInput, userUpdateInput } = await import('../src/routes/users.js');
const { passwordChangeRequired } = await import('../src/lib/auth.js');

test('generated passwords are long, unique and free of look-alike characters', async () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const pw = generatePassword();
    assert.match(pw, /^[a-km-zA-HJ-NP-Z2-9]{5}(-[a-km-zA-HJ-NP-Z2-9]{5}){3}$/);
    assert.ok(!/[0O1lI]/.test(pw));
    seen.add(pw);
  }
  assert.equal(seen.size, 500);
  const pw = generatePassword();
  assert.equal(await verifyPassword(await hashPassword(pw), pw), true);
});

test('a first admin is invited by default and can get generated login details instead', () => {
  const invited = adminInput.parse({ name: 'Jan', email: 'Jan@Example.com' });
  assert.equal(invited?.credentials, 'invite');
  assert.equal(invited?.email, 'jan@example.com');
  const generated = adminInput.parse({ name: 'Jan', email: 'jan@example.com', credentials: 'generate' });
  assert.equal(generated?.credentials, 'generate');
  assert.equal(generated?.mustChangePassword, true);
  assert.equal(adminInput.safeParse({ name: 'Jan', email: 'jan@example.com', credentials: 'sms' }).success, false);
});

test('only adding a user takes the login-details choice', () => {
  const add = userInput.parse({ name: 'A', email: 'a@b.nl', role: 'tenant_user', credentials: 'generate', mustChangePassword: false });
  assert.equal(add.credentials, 'generate');
  assert.equal(add.mustChangePassword, false);
  const change = userUpdateInput.parse({ name: 'B', credentials: 'generate', mustChangePassword: false, sendInvite: true });
  for (const key of ['credentials', 'mustChangePassword', 'sendInvite']) assert.ok(!(key in change), key);
});

test('a generated password must be replaced after a password sign-in, not after Microsoft sign-in', () => {
  const user = { mustChangePassword: true } as never;
  assert.equal(passwordChangeRequired(user, 'password'), true);
  assert.equal(passwordChangeRequired(user, 'entra'), false);
  assert.equal(passwordChangeRequired({ mustChangePassword: false } as never, 'password'), false);
});
