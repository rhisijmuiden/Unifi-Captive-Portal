import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_SECRET ??= 'test-secret-test-secret';
const { aligned, dkimPublicKey, dkimRecordValue, evaluateDkim, evaluateDmarc, evaluateSpf, generateDkimKey, heloName } = await import('../src/services/mailDns.js');
const { smtpSchema } = await import('../src/services/settings.js');

test('an EHLO name set by the admin is used as is', async () => {
  assert.deepEqual(await heloName({ heloName: 'portal.rhis.nl' }), { name: 'portal.rhis.nl', source: 'setting' });
  assert.throws(() => smtpSchema.parse({ heloName: '10.0.0.5' }));
  assert.equal(smtpSchema.parse({ heloName: 'Portal.RHIS.nl.' }).heloName, 'portal.rhis.nl');
});

test('SPF: missing, +all, IP not listed and OK', () => {
  assert.equal(evaluateSpf([], 'rhis.nl', '203.0.113.7').message, 'spfMissing');
  assert.equal(evaluateSpf([], 'rhis.nl', '203.0.113.7').suggest?.value, 'v=spf1 mx ip4:203.0.113.7 ~all');
  assert.equal(evaluateSpf(['v=spf1 +all'], 'rhis.nl', '').message, 'spfPassAll');
  assert.equal(evaluateSpf(['v=spf1 a', 'v=spf1 mx'], 'rhis.nl', '').message, 'spfMultiple');
  const notListed = evaluateSpf(['v=spf1 mx include:spf.protection.outlook.com -all'], 'rhis.nl', '203.0.113.7');
  assert.equal(notListed.message, 'spfIpNotListed');
  assert.equal(notListed.suggest?.value, 'v=spf1 mx include:spf.protection.outlook.com ip4:203.0.113.7 -all');
  assert.equal(evaluateSpf(['google-site-verification=x', 'v=spf1 ip4:203.0.113.7 -all'], 'rhis.nl', '203.0.113.7').status, 'ok');
  assert.equal(evaluateSpf(null, 'rhis.nl', '').message, 'dnsFailed');
});

test('DMARC: policy is read, a missing record gets a suggestion', () => {
  const ok = evaluateDmarc(['v=DMARC1; p=quarantine; rua=mailto:x@rhis.nl'], 'rhis.nl');
  assert.equal(ok.status, 'ok');
  assert.equal(ok.params?.policy, 'quarantine');
  const missing = evaluateDmarc([], 'rhis.nl');
  assert.equal(missing.message, 'dmarcMissing');
  assert.equal(missing.suggest?.name, '_dmarc.rhis.nl');
});

test('DKIM: generated key matches its DNS record, wrong or unaligned records are caught', () => {
  const key = generateDkimKey();
  const pub = dkimPublicKey(key);
  assert.ok(pub && pub.length > 300);
  assert.equal(dkimPublicKey('not a key'), null);
  const s = smtpSchema.parse({ dkimEnabled: true, dkimDomain: 'rhis.nl', dkimSelector: 'portal', dkimPrivateKey: key });
  // DNS returns long records in 255-character chunks that we join; spaces inside p= are allowed
  const published = dkimRecordValue(pub!).replace(/(.{40})/, '$1 ');
  assert.equal(evaluateDkim(s, [published], 'rhis.nl').status, 'ok');
  assert.equal(evaluateDkim(s, [], 'rhis.nl').message, 'dkimMissing');
  assert.equal(evaluateDkim(s, [], 'rhis.nl').suggest?.name, 'portal._domainkey.rhis.nl');
  assert.equal(evaluateDkim(s, [dkimRecordValue(dkimPublicKey(generateDkimKey())!)], 'rhis.nl').message, 'dkimMismatch');
  assert.equal(evaluateDkim(s, [published], 'example.com').message, 'dkimNotAligned');
  assert.equal(evaluateDkim(smtpSchema.parse({}), [], 'rhis.nl').message, 'dkimOff');
  assert.ok(aligned('mail.rhis.nl', 'rhis.nl'));
  assert.ok(!aligned('notrhis.nl', 'rhis.nl'));
});
