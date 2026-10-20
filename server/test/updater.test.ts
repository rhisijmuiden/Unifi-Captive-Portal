import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_SECRET ??= 'test-secret-test-secret';
const { compareVersions, latestForChannel } = await import('../src/services/updater.js');

test('compareVersions orders releases and pre-releases', () => {
  const sorted = ['1.2.0', '1.2.0-beta.2', '1.10.0', '1.2.0-beta.10', '1.2.0-rc.1', 'v1.1.9', '1.2.1'].sort(compareVersions);
  assert.deepEqual(sorted, ['v1.1.9', '1.2.0-beta.2', '1.2.0-beta.10', '1.2.0-rc.1', '1.2.0', '1.2.1', '1.10.0']);
  assert.equal(compareVersions('0.1.0', 'v0.1.0'), 0);
});

test('latestForChannel respects the update channel', () => {
  const r = (version: string, prerelease: boolean) => ({ version, name: version, notes: '', url: '', publishedAt: null, prerelease });
  const releases = [r('1.0.0', false), r('1.1.0-beta.1', true), r('1.0.1', false)];
  assert.equal(latestForChannel(releases, 'stable')?.version, '1.0.1');
  assert.equal(latestForChannel(releases, 'test')?.version, '1.1.0-beta.1');
  assert.equal(latestForChannel([r('2.0.0-rc.1', true)], 'stable'), null);
  // test channel moves on to a newer stable release
  assert.equal(latestForChannel([...releases, r('1.1.0', false)], 'test')?.version, '1.1.0');
});
