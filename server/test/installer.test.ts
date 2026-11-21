import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_SECRET ??= 'test-secret-test-secret';
const { consoleIssue, consoleUrls, isInstallerAccount } = await import('../src/services/installerAdmin.js');

test('the console banner shows the web address and, until it is changed, the generated login', () => {
  const withLogin = consoleIssue({ username: 'admin', password: 'abcde-fghij-kmnop-qrstu' }, '9.9.9');
  assert.match(withLogin, /Captive Portal 9\.9\.9/);
  assert.match(withLogin, /Web interface : http:\/\/\\4:8080/);
  assert.match(withLogin, /Username {6}: admin/);
  assert.match(withLogin, /Password {6}: abcde-fghij-kmnop-qrstu/);
  const after = consoleIssue(null, '9.9.9');
  assert.doesNotMatch(after, /Password/);
  assert.match(after, /captive-portal-admin reset-password/);
});

test('a hostname in PUBLIC_URL is shown next to the live IP address; an IP address is not repeated', () => {
  assert.deepEqual(consoleUrls('https://portal.example.com', 8080), ['https://portal.example.com', 'http://\\4:8080']);
  assert.deepEqual(consoleUrls('http://10.0.0.5:8080', 8080), ['http://\\4:8080']);
  assert.deepEqual(consoleUrls('http://localhost:8080', 8080), ['http://\\4:8080']);
});

test('only the installer-made main administrator signs in with a username', () => {
  assert.equal(isInstallerAccount({ email: 'admin', role: 'superadmin' }), true);
  assert.equal(isInstallerAccount({ email: 'admin@example.com', role: 'superadmin' }), false);
  assert.equal(isInstallerAccount({ email: 'admin', role: 'tenant_admin' }), false);
});
