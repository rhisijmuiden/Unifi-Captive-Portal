import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_SECRET ??= 'test-secret-test-secret';
const { hashEmail, splitName } = await import('../src/services/marketing.js');
const { csvCell } = await import('../src/routes/marketing.js');
const { adInput, looksLikeVideo } = await import('../src/routes/ads.js');
const { surveySettingsSchema } = await import('../src/services/tenantSettings.js');

test('names are split for the newsletter provider', () => {
  assert.deepEqual(splitName('Eva Jansen'), { first: 'Eva', last: 'Jansen' });
  assert.deepEqual(splitName('  Jan van der  Berg '), { first: 'Jan', last: 'van der Berg' });
  assert.deepEqual(splitName('Cher'), { first: 'Cher', last: '' });
  assert.deepEqual(splitName(null), { first: '', last: '' });
});

test('e-mail hashes ignore case and spaces', () => {
  assert.equal(hashEmail(' Eva@Example.com '), hashEmail('eva@example.com'));
});

test('CSV cells are quoted and formulas neutralised', () => {
  assert.equal(csvCell('a "b"'), '"a ""b"""');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+31612345678'), `"'+31612345678"`);
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(new Date('2026-10-21T10:00:00Z')), '"2026-10-21T10:00:00.000Z"');
});

test('only real mp4 and WebM files are accepted as video', () => {
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom')]);
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]);
  assert.ok(looksLikeVideo('video/mp4', mp4));
  assert.ok(looksLikeVideo('video/webm', webm));
  assert.ok(!looksLikeVideo('video/mp4', webm));
  assert.ok(!looksLikeVideo('video/webm', Buffer.from('<html>')));
});

test('ads need a web link and a sane wait', () => {
  const base = { name: 'Menu', kind: 'image', mediaId: '7c4f1f6e-5b1e-4c3a-9a1e-0d2b3c4d5e6f', placement: 'after' };
  assert.equal(adInput.parse({ ...base, linkUrl: '' }).linkUrl, null);
  assert.equal(adInput.parse(base).seconds, 5);
  assert.throws(() => adInput.parse({ ...base, linkUrl: 'javascript:alert(1)' }));
  assert.throws(() => adInput.parse({ ...base, seconds: 120 }));
});

test('the Google review link must be https', () => {
  assert.equal(surveySettingsSchema.parse({ googleReviewUrl: 'https://g.page/r/x/review' }).googleReviewUrl, 'https://g.page/r/x/review');
  assert.throws(() => surveySettingsSchema.parse({ googleReviewUrl: 'http://example.com' }));
});
