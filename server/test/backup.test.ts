import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://unused@localhost/unused';
process.env.APP_SECRET ??= 'test-secret-test-secret';
const { splitDumpText, encryptBuffer, decryptBuffer, deriveKey, newSalt, dueBackup, planRetention, lastFullSlot, lastIncrementalSlot, makeSetId, defaultSchedule } = await import(
  '../src/services/backup/format.js'
);
const { createBackup, listSets, prepareRestore, applyRetention, RestoreError } = await import('../src/services/backup/engine.js');
const { openStore } = await import('../src/services/backup/stores.js');

const dump = (users: string, extra = '') => `--
-- PostgreSQL database dump
--

SET statement_timeout = 0;

--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (id integer, name text);

--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, name) FROM stdin;
${users}
\\.

--
-- Data for Name: notes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.notes (id, body) FROM stdin;
1	--
2	-- Name: not a header
${extra}\\.

--
-- PostgreSQL database dump complete
--

`;

test('a dump is split per table and joins back byte for byte', () => {
  const text = dump('1\tAda\n2\tGrace');
  const parts = splitDumpText(text);
  assert.equal(parts.join(''), text);
  assert.equal(parts.length, 4);
  assert.ok(parts[1].startsWith('--\n-- Name: users; Type: TABLE'));
  assert.ok(parts[2].includes('COPY public.users'));
  // Lines inside COPY data that look like headers are never split on
  assert.ok(parts[3].includes('2\t-- Name: not a header'));
});

test('encrypted buffers only open with the right key', async () => {
  const salt = newSalt();
  const key = await deriveKey('correct horse battery staple', salt);
  const wrong = await deriveKey('wrong passphrase!!', salt);
  const sealed = encryptBuffer(Buffer.from('hello backup'), key);
  assert.equal(decryptBuffer(sealed, key).toString(), 'hello backup');
  assert.throws(() => decryptBuffer(sealed, wrong));
});

test('set ids sort by time and say what they are', () => {
  assert.equal(makeSetId(new Date('2026-10-20T23:05:09Z'), 'full'), 'cp-20261020-230509-full');
  assert.equal(makeSetId(new Date('2026-01-02T03:04:05Z'), 'incremental'), 'cp-20260102-030405-incr');
});

test('schedule slots fall on the chosen day and hour', () => {
  const s = { ...defaultSchedule, fullEvery: 'week' as const, weekday: 0, hour: 2 };
  // Tuesday 20 October 2026, 15:30 local time → Sunday 18 October 02:00
  const now = new Date(2026, 9, 20, 15, 30);
  assert.deepEqual(lastFullSlot(s, now), new Date(2026, 9, 18, 2, 0));
  assert.deepEqual(lastFullSlot({ ...s, fullEvery: 'day' }, new Date(2026, 9, 20, 1, 0)), new Date(2026, 9, 19, 2, 0));
  assert.deepEqual(lastFullSlot({ ...s, fullEvery: 'month', monthDay: 25 }, now), new Date(2026, 8, 25, 2, 0));
  assert.deepEqual(lastIncrementalSlot({ ...s, incremental: '6h' }, now), new Date(2026, 9, 20, 14, 0));
  assert.deepEqual(lastIncrementalSlot({ ...s, incremental: '24h' }, now), new Date(2026, 9, 20, 2, 0));
  assert.deepEqual(lastIncrementalSlot({ ...s, incremental: '1h' }, now), new Date(2026, 9, 20, 15, 0));
});

test('the schedule asks for a full backup first, then incrementals', () => {
  const s = { ...defaultSchedule, fullEvery: 'week' as const, weekday: 0, hour: 2, incremental: '24h' as const };
  const now = new Date(2026, 9, 20, 15, 30);
  const none = { lastFullAt: null, lastSuccessAt: null, lastAttemptAt: null };
  assert.equal(dueBackup(s, none, now), 'full');
  const fullSunday = new Date(2026, 9, 18, 2, 1);
  assert.equal(dueBackup(s, { lastFullAt: fullSunday, lastSuccessAt: fullSunday, lastAttemptAt: fullSunday }, now), 'incremental');
  const incrToday = new Date(2026, 9, 20, 2, 1);
  assert.equal(dueBackup(s, { lastFullAt: fullSunday, lastSuccessAt: incrToday, lastAttemptAt: incrToday }, now), null);
  // A failed attempt a few minutes ago is not retried yet
  assert.equal(dueBackup(s, { ...none, lastAttemptAt: new Date(2026, 9, 20, 15, 20) }, now), null);
  assert.equal(dueBackup({ ...s, enabled: false }, none, now), null);
  assert.equal(dueBackup({ ...s, incremental: 'off' }, { lastFullAt: fullSunday, lastSuccessAt: fullSunday, lastAttemptAt: fullSunday }, now), null);
});

test('retention keeps the newest chains and drops orphans', () => {
  const sets = [
    { id: 'cp-20261001-020000-full', type: 'full' as const, chain: 'cp-20261001-020000-full' },
    { id: 'cp-20261002-020000-incr', type: 'incremental' as const, chain: 'cp-20261001-020000-full' },
    { id: 'cp-20261008-020000-full', type: 'full' as const, chain: 'cp-20261008-020000-full' },
    { id: 'cp-20261009-020000-incr', type: 'incremental' as const, chain: 'cp-20261008-020000-full' },
    { id: 'cp-20261015-020000-full', type: 'full' as const, chain: 'cp-20261015-020000-full' },
    { id: 'cp-20260901-020000-incr', type: 'incremental' as const, chain: 'cp-20260831-020000-full' },
  ];
  assert.deepEqual(planRetention(sets, 2), ['cp-20261002-020000-incr', 'cp-20261001-020000-full', 'cp-20260901-020000-incr']);
  assert.deepEqual(planRetention(sets, 5), ['cp-20260901-020000-incr']);
});

const source = (text: string) => () => ({ stream: Readable.from([text]), done: Promise.resolve() });

test('full and incremental backups restore exactly what was there', async () => {
  const base = await mkdtemp(join(tmpdir(), 'cp-backup-'));
  try {
    const dataDir = join(base, 'data');
    await mkdir(join(dataDir, 'uploads'), { recursive: true });
    await mkdir(join(dataDir, 'update'), { recursive: true });
    await writeFile(join(dataDir, 'uploads', 'logo.svg'), '<svg/>');
    const big = randomBytes(200_000);
    await writeFile(join(dataDir, 'uploads', 'big.bin'), big);
    await writeFile(join(dataDir, 'update', 'status.json'), '{}');
    const { store } = await openStore({ type: 'local', path: join(base, 'remote'), host: '', port: 0, username: '', password: '', tlsMode: 'explicit', verifyCertificate: true, authMethod: 'key', privateKey: '', hostKey: '' });
    const common = { store, root: '/', passphrase: 'a long backup passphrase', dataDir, exclude: ['update'], workDir: join(base, 'work'), appVersion: '0.5.0', hostname: 'test', appSecret: 'app-secret-from-backup' };

    const first = dump('1\tAda');
    const full = await createBackup({ ...common, type: 'full', parent: null, dump: source(first), now: new Date('2026-10-18T02:00:00Z') });
    assert.equal(full.info.type, 'full');
    assert.ok(full.manifest.entries.every((e) => e.set === full.info.id));
    assert.ok(!full.manifest.entries.some((e) => e.p.startsWith('files/update')));

    // Change one table and add a file; the large file stays the same
    const second = dump('1\tAda\n2\tGrace');
    await writeFile(join(dataDir, 'uploads', 'new.txt'), 'new');
    const incr = await createBackup({ ...common, type: 'incremental', parent: full.manifest, dump: source(second), now: new Date('2026-10-19T02:00:00Z') });
    const own = incr.manifest.entries.filter((e) => e.set === incr.info.id).map((e) => e.p);
    assert.deepEqual(own.sort(), ['db/000003', 'files/uploads/new.txt']);
    assert.equal(incr.info.chain, full.info.id);
    assert.ok(incr.info.storedBytes < full.info.storedBytes / 4);

    const sets = await listSets(store, '/');
    assert.deepEqual(sets.map((s) => s.id), [incr.info.id, full.info.id]);

    const staging = join(base, 'staging');
    await prepareRestore({ store, root: '/', setId: incr.info.id, passphrase: common.passphrase, staging, appVersion: '0.5.0' });
    assert.equal(await readFile(join(staging, 'database.sql'), 'utf8'), second);
    assert.equal(await readFile(join(staging, 'files', 'uploads', 'new.txt'), 'utf8'), 'new');
    assert.deepEqual(await readFile(join(staging, 'files', 'uploads', 'big.bin')), big);
    assert.equal(await readFile(join(staging, 'app-secret'), 'utf8'), 'app-secret-from-backup');
    assert.deepEqual((await readdir(join(staging, 'files'))).sort(), ['uploads']);

    await assert.rejects(prepareRestore({ store, root: '/', setId: incr.info.id, passphrase: 'not the passphrase', staging, appVersion: '0.5.0' }), (err: unknown) => err instanceof RestoreError && err.code === 'wrongPassphrase');
    await assert.rejects(prepareRestore({ store, root: '/', setId: incr.info.id, passphrase: common.passphrase, staging, appVersion: '0.4.0' }), (err: unknown) => err instanceof RestoreError && err.code === 'newerVersion');

    // A new full backup re-reads nothing that is unchanged but uploads everything again
    await utimes(join(dataDir, 'uploads', 'logo.svg'), new Date(), new Date('2026-01-01'));
    const full2 = await createBackup({ ...common, type: 'full', parent: incr.manifest, dump: source(second), now: new Date('2026-10-25T02:00:00Z') });
    assert.ok(full2.manifest.entries.every((e) => e.set === full2.info.id));
    assert.deepEqual(await applyRetention(store, '/', 1, [full2.info.id]), [incr.info.id, full.info.id]);
    assert.deepEqual((await listSets(store, '/')).map((s) => s.id), [full2.info.id]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
