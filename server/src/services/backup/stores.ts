import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import { posix, resolve, sep } from 'node:path';
import { Client as FtpClient } from 'basic-ftp';
import { Client as SshClient, type ConnectConfig, type SFTPWrapper } from 'ssh2';

/**
 * Remote backup locations. Every location offers the same few operations on absolute
 * paths, so the backup engine does not care whether it talks FTP, FTPS, SSH or a folder.
 */
export interface RemoteStore {
  ensureDir(dir: string): Promise<void>;
  upload(localFile: string, remote: string): Promise<void>;
  download(remote: string, localFile: string): Promise<void>;
  writeFile(remote: string, data: Buffer): Promise<void>;
  readFile(remote: string): Promise<Buffer>;
  /** Folder names directly under `dir`; empty when `dir` does not exist */
  listDirs(dir: string): Promise<string[]>;
  removeDir(dir: string): Promise<void>;
  close(): Promise<void>;
}

export type StoreConfig = {
  type: 'local' | 'ftp' | 'ftps' | 'scp';
  host: string;
  port: number;
  username: string;
  password: string;
  /** ftps: explicit = AUTH TLS on port 21, implicit = TLS from the first byte on port 990 */
  tlsMode: 'explicit' | 'implicit';
  verifyCertificate: boolean;
  /** scp: sign in with the platform's SSH key or with a password */
  authMethod: 'key' | 'password';
  privateKey: string;
  /** scp: SHA256 fingerprint of the server's host key, remembered on first connect */
  hostKey: string;
  path: string;
};

export const defaultPorts = { local: 0, ftp: 21, ftps: 21, scp: 22 } as const;

export class HostKeyMismatch extends Error {
  constructor(public seen: string) {
    super('The SSH host key of the backup server has changed');
  }
}

// ── Local folder ───────────────────────────────────────────────────────────

class LocalStore implements RemoteStore {
  constructor(private readonly base: string) {}

  /** Remote paths stay inside the configured folder */
  private real(p: string) {
    const full = resolve(this.base, `.${posix.resolve('/', p)}`);
    if (full !== this.base && !full.startsWith(this.base + sep)) throw new Error('Path outside the backup folder');
    return full;
  }
  async ensureDir(dir: string) {
    await mkdir(this.real(dir), { recursive: true });
  }
  async upload(localFile: string, remote: string) {
    await copyFile(localFile, this.real(remote));
  }
  async download(remote: string, localFile: string) {
    await copyFile(this.real(remote), localFile);
  }
  async writeFile(remote: string, data: Buffer) {
    await writeFile(this.real(remote), data);
  }
  async readFile(remote: string) {
    return readFile(this.real(remote));
  }
  async listDirs(dir: string) {
    const entries = await readdir(this.real(dir), { withFileTypes: true }).catch(() => []);
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }
  async removeDir(dir: string) {
    await rm(this.real(dir), { recursive: true, force: true });
  }
  async close() {}
}

// ── FTP and FTPS ───────────────────────────────────────────────────────────

class FtpStore implements RemoteStore {
  private constructor(
    private readonly client: FtpClient,
    private readonly home: string,
  ) {}

  static async connect(c: StoreConfig) {
    const client = new FtpClient(60_000);
    const secure = c.type === 'ftps' ? (c.tlsMode === 'implicit' ? 'implicit' : true) : false;
    await client.access({
      host: c.host,
      port: c.port || (secure === 'implicit' ? 990 : 21),
      user: c.username || 'anonymous',
      password: c.password,
      secure,
      secureOptions: secure ? { minVersion: 'TLSv1.2', rejectUnauthorized: c.verifyCertificate, servername: c.host } : undefined,
    });
    return new FtpStore(client, await client.pwd());
  }

  async ensureDir(dir: string) {
    // ensureDir changes the working folder; go back so relative paths keep meaning the same
    await this.client.ensureDir(dir);
    await this.client.cd(this.home);
  }
  async upload(localFile: string, remote: string) {
    await this.client.uploadFrom(localFile, remote);
  }
  async download(remote: string, localFile: string) {
    await this.client.downloadTo(localFile, remote);
  }
  async writeFile(remote: string, data: Buffer) {
    await this.client.uploadFrom(Readable.from([data]), remote);
  }
  async readFile(remote: string) {
    const chunks: Buffer[] = [];
    await this.client.downloadTo(
      new Writable({
        write(chunk: Buffer, _enc, cb) {
          chunks.push(chunk);
          cb();
        },
      }),
      remote,
    );
    return Buffer.concat(chunks);
  }
  async listDirs(dir: string) {
    try {
      return (await this.client.list(dir)).filter((f) => f.isDirectory && f.name !== '.' && f.name !== '..').map((f) => f.name);
    } catch {
      return [];
    }
  }
  async removeDir(dir: string) {
    await this.client.removeDir(dir);
  }
  async close() {
    this.client.close();
  }
}

// ── SCP (SSH) ──────────────────────────────────────────────────────────────
// Files go over the SSH file transfer subsystem (SFTP), which every SCP-capable server offers.

export const hostKeyFingerprint = (key: Buffer) => `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;

class SshStore implements RemoteStore {
  private constructor(
    private readonly conn: SshClient,
    private readonly sftp: SFTPWrapper,
  ) {}

  /** Connects and returns the store together with the host key fingerprint it saw. */
  static connect(c: StoreConfig): Promise<{ store: SshStore; hostKey: string }> {
    return new Promise((resolvePromise, reject) => {
      const conn = new SshClient();
      let seen = '';
      const options: ConnectConfig = {
        host: c.host,
        port: c.port || 22,
        username: c.username,
        readyTimeout: 20_000,
        keepaliveInterval: 15_000,
        hostVerifier: (key: Buffer) => {
          seen = hostKeyFingerprint(key);
          return !c.hostKey || c.hostKey === seen;
        },
        ...(c.authMethod === 'key' ? { privateKey: c.privateKey } : { password: c.password }),
      };
      conn
        .on('ready', () => {
          conn.sftp((err, sftp) => {
            if (err) {
              conn.end();
              reject(err);
            } else resolvePromise({ store: new SshStore(conn, sftp), hostKey: seen });
          });
        })
        .on('error', (err) => reject(c.hostKey && seen && seen !== c.hostKey ? new HostKeyMismatch(seen) : err))
        .connect(options);
    });
  }

  private call<T>(fn: (cb: (err: Error | null | undefined, value?: T) => void) => void) {
    return new Promise<T>((res, rej) => fn((err, value) => (err ? rej(err) : res(value as T))));
  }

  async ensureDir(dir: string) {
    let current = dir.startsWith('/') ? '/' : '';
    for (const part of dir.split('/').filter(Boolean)) {
      current = current ? posix.join(current, part) : part;
      const exists = await this.call<unknown>((cb) => this.sftp.stat(current, cb)).then(() => true, () => false);
      if (!exists) await this.call((cb) => this.sftp.mkdir(current, cb));
    }
  }
  async upload(localFile: string, remote: string) {
    await this.call((cb) => this.sftp.fastPut(localFile, remote, (err) => cb(err)));
  }
  async download(remote: string, localFile: string) {
    await this.call((cb) => this.sftp.fastGet(remote, localFile, (err) => cb(err)));
  }
  async writeFile(remote: string, data: Buffer) {
    await this.call((cb) => this.sftp.writeFile(remote, data, (err) => cb(err)));
  }
  async readFile(remote: string) {
    return this.call<Buffer>((cb) => this.sftp.readFile(remote, cb));
  }
  async listDirs(dir: string) {
    try {
      const list = await this.call<{ filename: string; attrs: { isDirectory(): boolean } }[]>((cb) => this.sftp.readdir(dir, cb));
      return list.filter((f) => f.attrs.isDirectory()).map((f) => f.filename);
    } catch {
      return [];
    }
  }
  async removeDir(dir: string) {
    const list = await this.call<{ filename: string; attrs: { isDirectory(): boolean } }[]>((cb) => this.sftp.readdir(dir, cb)).catch(() => null);
    if (!list) return;
    for (const f of list) {
      const p = posix.join(dir, f.filename);
      if (f.attrs.isDirectory()) await this.removeDir(p);
      else await this.call((cb) => this.sftp.unlink(p, cb));
    }
    await this.call((cb) => this.sftp.rmdir(dir, cb));
  }
  async close() {
    this.sftp.end();
    this.conn.end();
  }
}

/** Opens a connection to a backup location. `hostKey` is the SSH fingerprint seen (scp only). */
export async function openStore(c: StoreConfig): Promise<{ store: RemoteStore; hostKey: string }> {
  if (c.type === 'local') {
    const base = resolve(c.path);
    await mkdir(base, { recursive: true });
    return { store: new LocalStore(base), hostKey: '' };
  }
  if (c.type === 'scp') return SshStore.connect(c);
  return { store: await FtpStore.connect(c), hostKey: '' };
}

/** The folder the sets live in: the configured path, or / for a local folder (which is its own root). */
export const storeRoot = (c: Pick<StoreConfig, 'type' | 'path'>) => (c.type === 'local' ? '/' : c.path.replace(/\/+$/, '') || '/');

/** Writes, reads back and removes a small file, so a test proves the location is usable for backups. */
export async function probeStore(store: RemoteStore, root: string) {
  const dir = posix.join(root, `.cp-probe-${Date.now()}`);
  await store.ensureDir(dir);
  const payload = Buffer.from(`captive-portal ${new Date().toISOString()}`);
  await store.writeFile(posix.join(dir, 'probe.txt'), payload);
  const back = await store.readFile(posix.join(dir, 'probe.txt'));
  await store.removeDir(dir);
  if (!back.equals(payload)) throw new Error('The test file came back different');
}
