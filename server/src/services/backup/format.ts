import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, type BinaryLike } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip, gunzipSync, gzipSync } from 'node:zlib';

/**
 * The backup format. A backup set is a folder on the remote location:
 *
 *   cp-20261020-230000-full/
 *     info.json      plain: type, chain, date, version and the key salt (no secrets)
 *     manifest.bin   encrypted: every database part and file, with its sha256 and the set that holds it
 *     objects/<sha>  encrypted, gzipped content
 *
 * Content is stored by its hash, so an incremental set only uploads what changed since
 * the set before it and points to older sets for the rest. A full set holds everything.
 */

export type BackupType = 'full' | 'incremental';

export const SET_ID = /^cp-\d{8}-\d{6}-(full|incr)$/;
export const FORMAT = 1;

export type Entry = {
  /** db/000001 for a database part, files/<path> for a file in the data folder */
  p: string;
  /** sha256 of the plain content */
  s: string;
  /** size in bytes */
  n: number;
  /** the set whose objects/ folder holds the content */
  set: string;
  /** file mode and modification time (files only) */
  m?: number;
  t?: number;
};

export type Manifest = {
  format: typeof FORMAT;
  id: string;
  type: BackupType;
  chain: string;
  parent: string | null;
  createdAt: string;
  appVersion: string;
  hostname: string;
  /** Stored secrets in the database are encrypted with it, so a restore on a new server needs it too */
  appSecret: string;
  entries: Entry[];
};

export type SetInfo = {
  format: typeof FORMAT;
  app: 'captive-portal';
  id: string;
  type: BackupType;
  chain: string;
  parent: string | null;
  createdAt: string;
  appVersion: string;
  hostname: string;
  salt: string;
  entries: number;
  sizeBytes: number;
  storedBytes: number;
};

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** cp-YYYYMMDD-HHMMSS-full|incr in UTC, so sets sort by name. */
export function makeSetId(date: Date, type: BackupType) {
  const d = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  const t = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  return `cp-${d}-${t}-${type === 'full' ? 'full' : 'incr'}`;
}

// ── Encryption ─────────────────────────────────────────────────────────────
// AES-256-GCM with a key derived from the backup passphrase (scrypt) and a salt per set.

const MAGIC = Buffer.from('CPB1');
const HEADER = MAGIC.length + 12;
const TAG = 16;

export function deriveKey(passphrase: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export const newSalt = () => randomBytes(16);

export class DecryptError extends Error {}

export function encryptBuffer(plain: Buffer, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()]);
  return Buffer.concat([MAGIC, iv, data, cipher.getAuthTag()]);
}

export function decryptBuffer(payload: Buffer, key: Buffer) {
  if (payload.length < HEADER + TAG || !payload.subarray(0, MAGIC.length).equals(MAGIC)) throw new DecryptError('Not a backup file');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(MAGIC.length, HEADER));
    decipher.setAuthTag(payload.subarray(payload.length - TAG));
    return gunzipSync(Buffer.concat([decipher.update(payload.subarray(HEADER, payload.length - TAG)), decipher.final()]));
  } catch {
    throw new DecryptError('Wrong passphrase or damaged file');
  }
}

/** Compresses and encrypts a file; returns the encrypted size. */
export async function encryptFile(src: string, dest: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  await pipeline(
    createReadStream(src),
    createGzip(),
    cipher,
    async function* (source: AsyncIterable<Buffer>) {
      yield Buffer.concat([MAGIC, iv]);
      for await (const chunk of source) yield chunk;
      yield cipher.getAuthTag();
    },
    createWriteStream(dest),
  );
  return (await stat(dest)).size;
}

/** Decrypts a file written by encryptFile and checks the content against its sha256. */
export async function decryptFile(src: string, dest: string, key: Buffer, expectedSha: string) {
  const { size } = await stat(src);
  if (size < HEADER + TAG) throw new DecryptError('Damaged file');
  const head = Buffer.alloc(HEADER);
  const tag = Buffer.alloc(TAG);
  const fh = await open(src, 'r');
  try {
    await fh.read(head, 0, HEADER, 0);
    await fh.read(tag, 0, TAG, size - TAG);
  } finally {
    await fh.close();
  }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new DecryptError('Not a backup file');
  const decipher = createDecipheriv('aes-256-gcm', key, head.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  const hash = createHash('sha256');
  try {
    await pipeline(
      // An empty ciphertext is still a valid read: end is inclusive, so start > end yields nothing
      createReadStream(src, { start: HEADER, end: size - TAG - 1 }),
      decipher,
      createGunzip(),
      new Transform({
        transform(chunk: Buffer, _enc, cb) {
          hash.update(chunk);
          cb(null, chunk);
        },
      }),
      createWriteStream(dest),
    );
  } catch {
    throw new DecryptError('Wrong passphrase or damaged file');
  }
  if (hash.digest('hex') !== expectedSha) throw new DecryptError('Checksum mismatch');
}

export const sha256Hex = (data: BinaryLike) => createHash('sha256').update(data).digest('hex');

// ── Splitting a pg_dump ────────────────────────────────────────────────────

/**
 * Splits a plain pg_dump into parts, one per table definition or table's data, so an
 * incremental backup only stores the tables that changed. Joining the parts in order
 * gives the original dump byte for byte.
 *
 * pg_dump starts every object with a "--" line followed by "-- Name: …" or
 * "-- Data for Name: …". Lines inside COPY data are never split on.
 */
export class DumpSplitter {
  private inCopy = false;
  private held: string | null = null;

  constructor(private readonly emit: (line: string, startsPart: boolean) => void) {}

  push(line: string) {
    if (this.inCopy) {
      this.emit(line, false);
      if (line === '\\.') this.inCopy = false;
      return;
    }
    if (this.held !== null) {
      const starts = line.startsWith('-- Name: ') || line.startsWith('-- Data for Name: ');
      this.emit(this.held, starts);
      this.held = null;
    }
    if (line === '--') {
      this.held = line;
      return;
    }
    this.emit(line, false);
    if (/^COPY .* FROM stdin;$/.test(line)) this.inCopy = true;
  }

  end() {
    if (this.held !== null) this.emit(this.held, false);
    this.held = null;
  }
}

/** Splits a whole dump held in memory; used by the tests. */
export function splitDumpText(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  const lines = text.split('\n');
  const last = lines.pop();
  const splitter = new DumpSplitter((line, starts) => {
    if (starts && current) {
      parts.push(current);
      current = '';
    }
    current += `${line}\n`;
  });
  lines.forEach((l) => splitter.push(l));
  splitter.end();
  if (last) current += last;
  if (current) parts.push(current);
  return parts;
}

// ── Retention and scheduling ───────────────────────────────────────────────

/**
 * Sets to remove so that only the newest `keepFull` chains (a full backup and the
 * incrementals built on it) remain. Incrementals whose full backup is gone are removed too.
 */
export function planRetention(sets: Pick<SetInfo, 'id' | 'type' | 'chain'>[], keepFull: number, protect: string[] = []) {
  const fulls = sets.filter((s) => s.type === 'full').map((s) => s.id).sort().reverse();
  const keepChains = new Set([...fulls.slice(0, Math.max(1, keepFull)), ...sets.filter((s) => protect.includes(s.id)).map((s) => s.chain)]);
  return sets
    .filter((s) => !keepChains.has(s.chain) && !protect.includes(s.id))
    .map((s) => s.id)
    .sort()
    .reverse();
}

export type Schedule = {
  enabled: boolean;
  fullEvery: 'day' | 'week' | 'month';
  /** 0 = Sunday */
  weekday: number;
  monthDay: number;
  hour: number;
  incremental: 'off' | '1h' | '6h' | '12h' | '24h';
};

export const defaultSchedule: Schedule = { enabled: true, fullEvery: 'week', weekday: 0, monthDay: 1, hour: 2, incremental: '24h' };

export type ScheduleState = { lastFullAt: Date | null; lastSuccessAt: Date | null; lastAttemptAt: Date | null };

/** The most recent moment at or before `now` when a full backup was due (local time). */
export function lastFullSlot(s: Schedule, now: Date) {
  const slot = new Date(now);
  slot.setMinutes(0, 0, 0);
  slot.setHours(s.hour);
  if (s.fullEvery === 'day') {
    if (slot > now) slot.setDate(slot.getDate() - 1);
  } else if (s.fullEvery === 'week') {
    slot.setDate(slot.getDate() - ((slot.getDay() - s.weekday + 7) % 7));
    if (slot > now) slot.setDate(slot.getDate() - 7);
  } else {
    slot.setDate(s.monthDay);
    if (slot > now) {
      slot.setDate(1);
      slot.setMonth(slot.getMonth() - 1);
      slot.setDate(s.monthDay);
    }
  }
  return slot;
}

/** The most recent moment at or before `now` when an incremental backup was due. */
export function lastIncrementalSlot(s: Schedule, now: Date) {
  const every = { off: 0, '1h': 1, '6h': 6, '12h': 12, '24h': 24 }[s.incremental];
  const slot = new Date(now);
  slot.setMinutes(0, 0, 0);
  if (every <= 1) return slot;
  // Slots fall on the chosen hour and every `every` hours after it
  const back = (((slot.getHours() - s.hour) % every) + every) % every;
  slot.setHours(slot.getHours() - back);
  return slot;
}

const RETRY_AFTER_MS = 30 * 60_000;

/** Which backup the schedule asks for now, if any. A failed attempt is retried after half an hour. */
export function dueBackup(s: Schedule, state: ScheduleState, now = new Date()): BackupType | null {
  if (!s.enabled) return null;
  if (state.lastAttemptAt && now.getTime() - state.lastAttemptAt.getTime() < RETRY_AFTER_MS) return null;
  if (!state.lastFullAt || state.lastFullAt < lastFullSlot(s, now)) return 'full';
  if (s.incremental !== 'off' && (!state.lastSuccessAt || state.lastSuccessAt < lastIncrementalSlot(s, now))) return 'incremental';
  return null;
}
