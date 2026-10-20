import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { compareVersions } from '../updater.js';
import {
  DecryptError,
  decryptBuffer,
  decryptFile,
  deriveKey,
  DumpSplitter,
  encryptBuffer,
  encryptFile,
  FORMAT,
  makeSetId,
  newSalt,
  planRetention,
  SET_ID,
  type BackupType,
  type Entry,
  type Manifest,
  type SetInfo,
} from './format.js';
import type { RemoteStore } from './stores.js';

export type Progress = { phase: 'database' | 'files' | 'upload' | 'download' | 'assemble' | 'cleanup'; done: number; total: number };

/** The database dump as a stream, plus a promise that settles when pg_dump has exited. */
export type DumpSource = () => { stream: Readable; done: Promise<void> };

export type BackupInput = {
  store: RemoteStore;
  root: string;
  type: BackupType;
  passphrase: string;
  /** The last set on this location; required for an incremental backup */
  parent: Manifest | null;
  dump: DumpSource;
  dataDir: string;
  /** Top-level folders in the data folder that are not backed up */
  exclude: string[];
  workDir: string;
  appVersion: string;
  hostname: string;
  appSecret: string;
  now?: Date;
  onProgress?: (p: Progress) => void;
};

/** Content waiting in the work folder until it is known whether it needs uploading. */
type Pending = { entry: Omit<Entry, 'set'>; local: string | null };

async function hashToFile(source: Readable, dest: string) {
  const hash = createHash('sha256');
  let size = 0;
  await pipeline(
    source,
    async function* (chunks: AsyncIterable<Buffer>) {
      for await (const c of chunks) {
        hash.update(c);
        size += c.length;
        yield c;
      }
    },
    createWriteStream(dest),
  );
  return { sha: hash.digest('hex'), size };
}

/** Writes the dump into one file per part and hashes each part on the way. */
async function splitDatabase(dump: DumpSource, work: string): Promise<Pending[]> {
  const { stream, done } = dump();
  // Settled below; this only keeps an early pg_dump failure from being reported as unhandled
  done.catch(() => {});
  const parts: Pending[] = [];
  let part: { out: WriteStream; hash: ReturnType<typeof createHash>; size: number } | null = null;
  const close = async () => {
    if (!part) return;
    const { out, hash, size } = part;
    part = null;
    await new Promise<void>((res, rej) => out.end((err?: Error | null) => (err ? rej(err) : res())));
    const n = parts.length + 1;
    parts.push({ entry: { p: `db/${String(n).padStart(6, '0')}`, s: hash.digest('hex'), n: size }, local: out.path as string });
  };
  const queue: [string, boolean][] = [];
  const splitter = new DumpSplitter((line, startsPart) => queue.push([line, startsPart]));
  const flush = async () => {
    for (const [line, startsPart] of queue.splice(0)) {
      if (startsPart) await close();
      part ??= { out: createWriteStream(join(work, `db-${parts.length + 1}`)), hash: createHash('sha256'), size: 0 };
      const data = Buffer.from(`${line}\n`, 'utf8');
      part.hash.update(data);
      part.size += data.length;
      if (!part.out.write(data)) await once(part.out, 'drain');
    }
  };
  // readline drops the newlines; pg_dump ends every line (also the last) with one, so each line gets it back
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    splitter.push(line);
    await flush();
  }
  splitter.end();
  await flush();
  await close();
  await done;
  if (!parts.length) throw new Error('The database dump is empty');
  return parts;
}

async function* walk(dir: string, base: string, exclude: string[]): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, e.name);
    const rel = relative(base, full).split(sep).join('/');
    if (dir === base && exclude.includes(e.name)) continue;
    if (e.isDirectory()) yield* walk(full, base, exclude);
    else if (e.isFile()) yield rel;
  }
}

/** Data-folder files; unchanged files (same size and time) reuse the hash of the previous set. */
async function collectFiles(input: BackupInput, work: string, previous: Map<string, Entry>): Promise<Pending[]> {
  const out: Pending[] = [];
  for await (const rel of walk(input.dataDir, input.dataDir, input.exclude)) {
    const full = join(input.dataDir, rel);
    const st = await lstat(full).catch(() => null);
    if (!st?.isFile()) continue;
    const p = `files/${rel}`;
    const meta = { m: st.mode & 0o777, t: Math.round(st.mtimeMs) };
    const prev = previous.get(p);
    if (prev && prev.n === st.size && prev.t === meta.t) {
      out.push({ entry: { p, s: prev.s, n: prev.n, ...meta }, local: null });
      continue;
    }
    // Copy while hashing, so a file that changes during the backup cannot mismatch its hash
    const local = join(work, `f-${out.length + 1}`);
    const { sha, size } = await hashToFile(createReadStream(full), local);
    out.push({ entry: { p, s: sha, n: size, ...meta }, local });
  }
  return out;
}

/**
 * Makes a backup set on the remote location. A full set uploads everything; an incremental
 * set uploads only content that the previous set does not have, and points to older sets for the rest.
 */
export async function createBackup(input: BackupInput): Promise<{ info: SetInfo; manifest: Manifest }> {
  const now = input.now ?? new Date();
  if (input.type === 'incremental' && !input.parent) throw new Error('An incremental backup needs a previous backup');
  const parent = input.type === 'incremental' ? input.parent : null;
  const id = makeSetId(now, input.type);
  const chain = parent ? parent.chain : id;
  const work = join(input.workDir, id);
  const setDir = posix.join(input.root, id);
  const progress = input.onProgress ?? (() => {});

  const known = new Map<string, string>();
  const previousFiles = new Map<string, Entry>();
  for (const e of parent?.entries ?? []) {
    known.set(e.s, e.set);
    if (e.p.startsWith('files/')) previousFiles.set(e.p, e);
  }
  // A full backup still skips re-reading unchanged files; their content is uploaded again regardless
  for (const e of input.parent?.entries ?? []) if (e.p.startsWith('files/')) previousFiles.set(e.p, e);

  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  let uploadedAny = false;
  try {
    progress({ phase: 'database', done: 0, total: 1 });
    const pending = await splitDatabase(input.dump, work);
    progress({ phase: 'files', done: 0, total: 1 });
    const files = await collectFiles(input, work, previousFiles);
    pending.push(...files);

    const salt = newSalt();
    const key = await deriveKey(input.passphrase, salt);
    await input.store.ensureDir(posix.join(setDir, 'objects'));
    uploadedAny = true;

    const entries: Entry[] = [];
    const uploaded = new Set<string>();
    let storedBytes = 0;
    let sizeBytes = 0;
    const toUpload = pending.filter((p) => !known.has(p.entry.s)).length;
    let done = 0;
    for (const item of pending) {
      sizeBytes += item.entry.n;
      const elsewhere = known.get(item.entry.s);
      if (elsewhere) {
        entries.push({ ...item.entry, set: elsewhere });
        continue;
      }
      entries.push({ ...item.entry, set: id });
      if (uploaded.has(item.entry.s)) continue;
      const source = item.local ?? (await sourceForReuse(input, item, work));
      const encrypted = join(work, 'upload.bin');
      storedBytes += await encryptFile(source, encrypted, key);
      await input.store.upload(encrypted, posix.join(setDir, 'objects', item.entry.s));
      uploaded.add(item.entry.s);
      progress({ phase: 'upload', done: ++done, total: toUpload });
    }

    const manifest: Manifest = {
      format: FORMAT,
      id,
      type: input.type,
      chain,
      parent: parent?.id ?? null,
      createdAt: now.toISOString(),
      appVersion: input.appVersion,
      hostname: input.hostname,
      appSecret: input.appSecret,
      entries,
    };
    const manifestBin = encryptBuffer(Buffer.from(JSON.stringify(manifest)), key);
    await input.store.writeFile(posix.join(setDir, 'manifest.bin'), manifestBin);
    const info: SetInfo = {
      format: FORMAT,
      app: 'captive-portal',
      id,
      type: input.type,
      chain,
      parent: manifest.parent,
      createdAt: manifest.createdAt,
      appVersion: input.appVersion,
      hostname: input.hostname,
      salt: salt.toString('base64'),
      entries: entries.length,
      sizeBytes,
      storedBytes: storedBytes + manifestBin.length,
    };
    // info.json is written last: a set without it is incomplete and ignored
    await input.store.writeFile(posix.join(setDir, 'info.json'), Buffer.from(JSON.stringify(info, null, 2)));
    return { info, manifest };
  } catch (err) {
    if (uploadedAny) await input.store.removeDir(setDir).catch(() => {});
    throw err;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** A file skipped as unchanged whose content is not on the remote yet (full backup): read it now. */
async function sourceForReuse(input: BackupInput, item: Pending, work: string) {
  const local = join(work, 'reuse.bin');
  const { sha } = await hashToFile(createReadStream(join(input.dataDir, item.entry.p.slice('files/'.length))), local);
  if (sha !== item.entry.s) throw new Error(`File changed during the backup: ${item.entry.p}`);
  return local;
}

// ── Listing and retention ──────────────────────────────────────────────────

const isSetInfo = (v: unknown): v is SetInfo => {
  const s = v as SetInfo;
  return Boolean(s && s.app === 'captive-portal' && typeof s.id === 'string' && SET_ID.test(s.id) && typeof s.salt === 'string' && SET_ID.test(s.chain));
};

export async function readSetInfo(store: RemoteStore, root: string, id: string): Promise<SetInfo | null> {
  if (!SET_ID.test(id)) return null;
  try {
    const info = JSON.parse((await store.readFile(posix.join(root, id, 'info.json'))).toString('utf8'));
    return isSetInfo(info) && info.id === id ? info : null;
  } catch {
    return null;
  }
}

/** Complete sets on the location, newest first. */
export async function listSets(store: RemoteStore, root: string) {
  const ids = (await store.listDirs(root)).filter((d) => SET_ID.test(d)).sort().reverse();
  const sets: SetInfo[] = [];
  for (const id of ids) {
    const info = await readSetInfo(store, root, id);
    if (info) sets.push(info);
  }
  return sets;
}

/** Removes sets beyond the newest `keepFull` chains; returns the removed ids. */
export async function applyRetention(store: RemoteStore, root: string, keepFull: number, protect: string[]) {
  const sets = await listSets(store, root);
  const remove = planRetention(sets, keepFull, protect);
  for (const id of remove) await store.removeDir(posix.join(root, id));
  return remove;
}

// ── Restore ────────────────────────────────────────────────────────────────

export class RestoreError extends Error {
  constructor(
    public code: 'notFound' | 'wrongPassphrase' | 'newerVersion' | 'damaged',
    public params: Record<string, string> = {},
  ) {
    super(code);
  }
}

async function setKey(store: RemoteStore, root: string, id: string, passphrase: string, cache: Map<string, Buffer>) {
  const cached = cache.get(id);
  if (cached) return cached;
  const info = await readSetInfo(store, root, id);
  if (!info) throw new RestoreError('notFound', { set: id });
  const key = await deriveKey(passphrase, Buffer.from(info.salt, 'base64'));
  cache.set(id, key);
  return key;
}

/** Reads and decrypts the manifest of a set. */
export async function readManifest(store: RemoteStore, root: string, id: string, passphrase: string, keys = new Map<string, Buffer>()) {
  const key = await setKey(store, root, id, passphrase, keys);
  let manifest: Manifest;
  try {
    manifest = JSON.parse(decryptBuffer(await store.readFile(posix.join(root, id, 'manifest.bin')), key).toString('utf8'));
  } catch (err) {
    if (err instanceof DecryptError) throw new RestoreError('wrongPassphrase');
    throw new RestoreError('damaged', { reason: (err as Error).message });
  }
  if (manifest.id !== id || !Array.isArray(manifest.entries)) throw new RestoreError('damaged', { reason: 'manifest' });
  return manifest;
}

const SAFE_PATH = /^(?!.*(^|\/)\.\.?(\/|$))[^\0]+$/;

/**
 * Downloads a set (and the older sets it refers to) into `staging`:
 *   database.sql   the complete dump
 *   files/         the data folder
 *   app-secret     the APP_SECRET the stored secrets are encrypted with
 * The actual swap is done by install/restore.sh as root, with the service stopped.
 */
export async function prepareRestore(opts: {
  store: RemoteStore;
  root: string;
  setId: string;
  passphrase: string;
  staging: string;
  appVersion: string;
  onProgress?: (p: Progress) => void;
}) {
  const { store, root, staging } = opts;
  const progress = opts.onProgress ?? (() => {});
  const keys = new Map<string, Buffer>();
  const manifest = await readManifest(store, root, opts.setId, opts.passphrase, keys);
  if (compareVersions(manifest.appVersion, opts.appVersion) > 0) throw new RestoreError('newerVersion', { version: manifest.appVersion });

  await rm(staging, { recursive: true, force: true });
  const objects = join(staging, 'objects');
  const filesDir = resolve(staging, 'files');
  await mkdir(objects, { recursive: true });
  await mkdir(filesDir, { recursive: true });

  const unique = new Map<string, string>();
  for (const e of manifest.entries) {
    if (!/^[0-9a-f]{64}$/.test(e.s) || !SET_ID.test(e.set)) throw new RestoreError('damaged', { reason: e.p });
    unique.set(e.s, e.set);
  }
  let done = 0;
  const download = join(staging, 'download.bin');
  for (const [sha, set] of unique) {
    const key = await setKey(store, root, set, opts.passphrase, keys);
    try {
      await store.download(posix.join(root, set, 'objects', sha), download);
    } catch (err) {
      throw new RestoreError('damaged', { reason: `${set}/objects/${sha.slice(0, 12)}: ${(err as Error).message}` });
    }
    try {
      await decryptFile(download, join(objects, sha), key, sha);
    } catch (err) {
      throw new RestoreError('damaged', { reason: `${set}/objects/${sha.slice(0, 12)}: ${(err as Error).message}` });
    }
    progress({ phase: 'download', done: ++done, total: unique.size });
  }
  await rm(download, { force: true });

  progress({ phase: 'assemble', done: 0, total: 1 });
  const sql = createWriteStream(join(staging, 'database.sql'));
  for (const e of manifest.entries.filter((x) => x.p.startsWith('db/'))) {
    await pipeline(createReadStream(join(objects, e.s)), sql, { end: false });
  }
  await new Promise<void>((res, rej) => sql.end((err?: Error | null) => (err ? rej(err) : res())));

  for (const e of manifest.entries.filter((x) => x.p.startsWith('files/'))) {
    const rel = e.p.slice('files/'.length);
    const dest = resolve(filesDir, rel);
    if (!SAFE_PATH.test(rel) || !dest.startsWith(filesDir + sep)) throw new RestoreError('damaged', { reason: e.p });
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(join(objects, e.s), dest);
    if (e.m !== undefined) await chmod(dest, e.m & 0o777);
    if (e.t) await utimes(dest, new Date(e.t), new Date(e.t));
  }
  await rm(objects, { recursive: true, force: true });
  await writeFile(join(staging, 'app-secret'), manifest.appSecret, { mode: 0o600 });
  const meta = { setId: manifest.id, type: manifest.type, createdAt: manifest.createdAt, appVersion: manifest.appVersion, hostname: manifest.hostname };
  await writeFile(join(staging, 'restore.json'), JSON.stringify(meta, null, 2));
  return { manifest, sqlBytes: (await stat(join(staging, 'database.sql'))).size };
}
