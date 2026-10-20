import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import ssh2 from 'ssh2';
import { z } from 'zod';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { DEFAULT_LOCALE, normalizeLocale } from '../i18n/index.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { AppError, badRequest, notFound, translateError } from '../lib/errors.js';
import { applyRetention, createBackup, listSets, prepareRestore, readManifest, readSetInfo, RestoreError, type DumpSource, type Progress } from './backup/engine.js';
import { defaultSchedule, dueBackup, SET_ID, type BackupType, type Schedule } from './backup/format.js';
import { HostKeyMismatch, openStore, probeStore, storeRoot, type RemoteStore, type StoreConfig } from './backup/stores.js';
import { sendTemplate } from './mailTemplates.js';
import { adminBaseUrl, getSettings, saveSettings } from './settings.js';
import { readUpdateStatus, requestRestore, selfUpdateEnabled } from './updater.js';
import { emit } from './webhooks.js';

/**
 * Backups of the whole platform (database and data folder) to FTP, FTPS, SCP or a local
 * folder, full or incremental, on a schedule or on demand, and restoring them.
 * One backup or restore runs at a time.
 */

const workDir = join(config.dataDir, 'backup-work');
const restoreDir = join(config.dataDir, 'restore');
const stagingDir = join(restoreDir, 'staging');
const restoreStatusFile = join(restoreDir, 'status.json');
/** Local backup folders must live here: the service may only write inside its data folder */
export const localBase = join(config.dataDir, 'backups');
/** Data-folder entries that are never backed up: runtime state, local backups and work folders */
const EXCLUDE = ['update', 'backups', 'backup-work', 'restore'];

export const scheduleSchema = z.object({
  enabled: z.boolean().default(defaultSchedule.enabled),
  fullEvery: z.enum(['day', 'week', 'month']).default(defaultSchedule.fullEvery),
  weekday: z.coerce.number().int().min(0).max(6).default(defaultSchedule.weekday),
  monthDay: z.coerce.number().int().min(1).max(28).default(defaultSchedule.monthDay),
  hour: z.coerce.number().int().min(0).max(23).default(defaultSchedule.hour),
  incremental: z.enum(['off', '1h', '6h', '12h', '24h']).default(defaultSchedule.incremental),
});

const fingerprint = z.union([z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/), z.literal('')]);

export const targetSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: z.enum(['local', 'ftp', 'ftps', 'scp']),
    host: z.string().trim().max(255).default(''),
    port: z.coerce.number().int().min(0).max(65535).default(0),
    username: z.string().trim().max(200).default(''),
    // Empty keeps the stored password, null removes it
    password: z.string().max(500).nullable().optional(),
    tlsMode: z.enum(['explicit', 'implicit']).default('explicit'),
    verifyCertificate: z.boolean().default(true),
    authMethod: z.enum(['key', 'password']).default('key'),
    hostKey: fingerprint.optional(),
    path: z.string().trim().min(1).max(500),
    schedule: scheduleSchema.default(defaultSchedule),
    keepFull: z.coerce.number().int().min(1).max(100).default(4),
  })
  .superRefine((v, ctx) => {
    if (v.type !== 'local' && !/^[A-Za-z0-9.-]+$|^\[?[0-9a-fA-F:]+\]?$/.test(v.host)) ctx.addIssue({ code: 'custom', path: ['host'], message: 'errors.backupHost' });
    if (v.type === 'scp' && !v.username) ctx.addIssue({ code: 'custom', path: ['username'], message: 'errors.backupUsername' });
    if (v.type === 'local') {
      const full = resolve(v.path);
      if (!full.startsWith(localBase + sep)) ctx.addIssue({ code: 'custom', path: ['path'], message: 'errors.backupLocalPath' });
    } else if (/[\0\r\n]/.test(v.path)) ctx.addIssue({ code: 'custom', path: ['path'], message: 'errors.backupPath' });
  });
export type TargetInput = z.infer<typeof targetSchema>;

// ── State of the running job ───────────────────────────────────────────────

export type Job = {
  kind: 'backup' | 'restore';
  targetId: string;
  targetName: string;
  type?: BackupType;
  setId?: string;
  startedAt: string;
  progress: Progress | null;
};
let job: Job | null = null;
export const currentJob = () => job;

export type RestoreStatus = {
  state: 'idle' | 'preparing' | 'queued' | 'running' | 'success' | 'failed';
  code?: string;
  message?: string;
  setId?: string;
  updatedAt?: string;
};

export async function readRestoreStatus(): Promise<RestoreStatus> {
  try {
    return JSON.parse(await readFile(restoreStatusFile, 'utf8')) as RestoreStatus;
  } catch {
    return { state: 'idle' };
  }
}

async function writeRestoreStatus(status: RestoreStatus) {
  await mkdir(restoreDir, { recursive: true });
  await writeFile(restoreStatusFile, JSON.stringify({ ...status, updatedAt: new Date().toISOString() }));
}

// ── Targets ────────────────────────────────────────────────────────────────

export function publicTarget(t: schema.BackupTarget) {
  const { password, lastManifest, ...rest } = t;
  return { ...rest, passwordSet: Boolean(password), lastSetId: lastManifest?.id ?? null, lastChain: lastManifest?.chain ?? null };
}

export async function listTargets() {
  return db.query.backupTargets.findMany({ orderBy: schema.backupTargets.createdAt });
}

async function getTarget(id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound();
  const target = await db.query.backupTargets.findFirst({ where: eq(schema.backupTargets.id, id) });
  if (!target) throw notFound();
  return target;
}

const connectionChanged = (a: Pick<TargetInput, 'type' | 'host' | 'port'>, b: Pick<TargetInput, 'type' | 'host' | 'port'>) => a.type !== b.type || a.host !== b.host || a.port !== b.port;

function storedPassword(input: TargetInput, current?: schema.BackupTarget) {
  if (input.password === null) return '';
  if (input.password) return encrypt(input.password);
  return current?.password ?? '';
}

export async function createTarget(input: TargetInput) {
  const [row] = await db
    .insert(schema.backupTargets)
    .values({ ...input, password: storedPassword(input), hostKey: input.hostKey ?? '' })
    .returning();
  return row;
}

export async function updateTarget(id: string, input: TargetInput) {
  const current = await getTarget(id);
  const moved = connectionChanged(input, current) || input.path !== current.path;
  const [row] = await db
    .update(schema.backupTargets)
    .set({
      ...input,
      password: storedPassword(input, current),
      // A new address means a new server (and host key); a new folder means a new chain of backups
      hostKey: input.hostKey ?? (connectionChanged(input, current) ? '' : current.hostKey),
      ...(moved ? { lastManifest: null, lastFullAt: null, lastSuccessAt: null } : {}),
    })
    .where(eq(schema.backupTargets.id, id))
    .returning();
  return row;
}

export async function deleteTarget(id: string) {
  if (job?.targetId === id) throw badRequest('errors.backupBusy');
  await db.delete(schema.backupTargets).where(eq(schema.backupTargets.id, id));
}

// ── Connections ────────────────────────────────────────────────────────────

/** The platform's SSH key for SCP locations, created the first time it is needed. */
export async function ensureSshKey() {
  const current = await getSettings('backup');
  if (current.sshPublicKey && current.sshPrivateKey) return current.sshPublicKey;
  return regenerateSshKey();
}

export async function regenerateSshKey() {
  const pair = ssh2.utils.generateKeyPairSync('ed25519', { comment: `captive-portal@${hostname()}` });
  await saveSettings('backup', { sshPrivateKey: pair.private, sshPublicKey: pair.public.trim() });
  return pair.public.trim();
}

type Connection = Pick<schema.BackupTarget, 'type' | 'host' | 'port' | 'username' | 'password' | 'tlsMode' | 'verifyCertificate' | 'authMethod' | 'hostKey' | 'path'>;

async function storeConfig(t: Connection): Promise<StoreConfig> {
  let privateKey = '';
  if (t.type === 'scp' && t.authMethod === 'key') {
    await ensureSshKey();
    privateKey = (await getSettings('backup')).sshPrivateKey;
  }
  return {
    type: t.type,
    host: t.host,
    port: t.port,
    username: t.username,
    password: t.password ? decrypt(t.password) : '',
    tlsMode: t.tlsMode,
    verifyCertificate: t.verifyCertificate,
    authMethod: t.authMethod,
    privateKey,
    hostKey: t.hostKey,
    path: t.path,
  };
}

function connectError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof HostKeyMismatch) return badRequest('errors.backupHostKey', { fingerprint: err.seen });
  return badRequest('errors.backupConnect', { reason: (err as Error).message || String(err) });
}

/** Opens the target, remembers a new SSH host key and always closes the connection. */
async function withStore<T>(target: schema.BackupTarget, fn: (store: RemoteStore, root: string) => Promise<T>): Promise<T> {
  const cfg = await storeConfig(target);
  let opened: Awaited<ReturnType<typeof openStore>>;
  try {
    opened = await openStore(cfg);
  } catch (err) {
    throw connectError(err);
  }
  try {
    if (target.type === 'scp' && !target.hostKey && opened.hostKey) {
      await db.update(schema.backupTargets).set({ hostKey: opened.hostKey }).where(eq(schema.backupTargets.id, target.id));
    }
    return await fn(opened.store, storeRoot(cfg));
  } finally {
    await opened.store.close().catch(() => {});
  }
}

/** Tests a location as typed in the form, falling back to the stored password. */
export async function testTarget(input: TargetInput, id?: string) {
  const current = id ? await getTarget(id) : undefined;
  const cfg = await storeConfig({
    ...input,
    password: storedPassword(input, current),
    hostKey: input.hostKey ?? (current && !connectionChanged(input, current) ? current.hostKey : ''),
  });
  let opened: Awaited<ReturnType<typeof openStore>>;
  try {
    opened = await openStore(cfg);
  } catch (err) {
    throw connectError(err);
  }
  try {
    await probeStore(opened.store, storeRoot(cfg));
    const sets = await listSets(opened.store, storeRoot(cfg));
    return { hostKey: opened.hostKey, sets: sets.length };
  } catch (err) {
    throw badRequest('errors.backupWrite', { reason: (err as Error).message });
  } finally {
    await opened.store.close().catch(() => {});
  }
}

// ── Backups ────────────────────────────────────────────────────────────────

function pgEnv() {
  const url = new URL(config.databaseUrl);
  const env: Record<string, string> = {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  };
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

/** pg_dump in plain SQL without owners or grants, so it restores into a fresh, empty schema. */
export const dumpDatabase: DumpSource = () => {
  // The password goes through the environment, never on the command line
  const child = spawn('pg_dump', ['--no-owner', '--no-privileges', '--format=plain', '--encoding=UTF8'], {
    env: { ...process.env, ...pgEnv() },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
  const done = new Promise<void>((res, rej) => {
    child.on('error', (err) => rej(new Error(`pg_dump: ${err.message}`)));
    child.on('close', (code) => (code === 0 ? res() : rej(new Error(`pg_dump: ${stderr.trim() || `exit code ${code}`}`))));
  });
  return { stream: child.stdout, done };
};

const errorText = (err: unknown) => translateError(err, DEFAULT_LOCALE).slice(0, 2000);

async function notifyFailure(targetName: string, error: string) {
  const { notifyOnFailure } = await getSettings('backup');
  const smtp = await getSettings('smtp');
  if (!notifyOnFailure || !smtp.enabled) return;
  const admins = await db.query.users.findMany({ where: eq(schema.users.role, 'superadmin') });
  const actionUrl = `${await adminBaseUrl()}/backups`;
  for (const admin of admins.filter((a) => a.isActive)) {
    const locale = normalizeLocale(admin.locale) ?? DEFAULT_LOCALE;
    await sendTemplate(admin.email, 'backupFailed', locale, null, {
      vars: { name: admin.name, targetName, error, date: new Date().toLocaleString(locale === 'nl' ? 'nl-NL' : 'en-GB'), actionUrl },
    }).catch(() => {});
  }
}

/** Runs one backup; resolves when it is done (successful or not). */
async function runBackup(target: schema.BackupTarget, requested: BackupType, trigger: 'schedule' | 'manual', passphrase: string) {
  const startedAt = new Date();
  await db.update(schema.backupTargets).set({ lastAttemptAt: startedAt }).where(eq(schema.backupTargets.id, target.id));
  let type = requested;
  try {
    const result = await withStore(target, async (store, root) => {
      const parent = target.lastManifest ? { ...target.lastManifest, appSecret: '' } : null;
      // Without the previous set on the location (removed, or a new folder) a new chain starts
      if (type === 'incremental' && (!parent || !(await readSetInfo(store, root, parent.id)))) type = 'full';
      if (job) job.type = type;
      const made = await createBackup({
        store,
        root,
        type,
        passphrase,
        parent,
        dump: dumpDatabase,
        dataDir: config.dataDir,
        exclude: EXCLUDE,
        workDir,
        appVersion: config.version,
        hostname: hostname(),
        appSecret: config.appSecret,
        now: startedAt,
        onProgress: (p) => {
          if (job) job.progress = p;
        },
      });
      if (job) job.progress = { phase: 'cleanup', done: 0, total: 1 };
      // Clearing out old sets must never turn a good backup into a failed one
      const removed = await applyRetention(store, root, target.keepFull, [made.info.id]).catch(() => [] as string[]);
      return { ...made, removed };
    });
    const { appSecret: _secret, ...stored } = result.manifest;
    await db
      .update(schema.backupTargets)
      .set({ lastManifest: stored, lastSuccessAt: new Date(), lastError: null, ...(type === 'full' ? { lastFullAt: startedAt } : {}) })
      .where(eq(schema.backupTargets.id, target.id));
    await db.insert(schema.backupRuns).values({
      targetId: target.id,
      targetName: target.name,
      setId: result.info.id,
      type,
      trigger,
      status: 'success',
      entries: result.info.entries,
      sizeBytes: result.info.sizeBytes,
      storedBytes: result.info.storedBytes,
      removedSets: result.removed.length,
      startedAt,
      finishedAt: new Date(),
    });
    emit(null, 'backup.succeeded', { target: target.name, setId: result.info.id, type, trigger, sizeBytes: result.info.sizeBytes, storedBytes: result.info.storedBytes, startedAt });
  } catch (err) {
    const error = errorText(err);
    await db.update(schema.backupTargets).set({ lastError: error }).where(eq(schema.backupTargets.id, target.id));
    await db.insert(schema.backupRuns).values({ targetId: target.id, targetName: target.name, type, trigger, status: 'failed', error, startedAt, finishedAt: new Date() });
    await notifyFailure(target.name, error).catch(() => {});
    emit(null, 'backup.failed', { target: target.name, type, trigger, error, startedAt });
  }
}

async function requirePassphrase() {
  const { passphrase } = await getSettings('backup');
  if (!passphrase) throw badRequest('errors.backupPassphrase');
  return passphrase;
}

/** Starts a backup in the background; throws straight away when it cannot start. */
export async function startBackup(targetId: string, type: BackupType) {
  if (job) throw badRequest('errors.backupBusy');
  const target = await getTarget(targetId);
  const passphrase = await requirePassphrase();
  job = { kind: 'backup', targetId: target.id, targetName: target.name, type, startedAt: new Date().toISOString(), progress: null };
  runBackup(target, type, 'manual', passphrase).finally(() => (job = null));
}

/** Called every minute: runs the first backup the schedules ask for. */
export async function runScheduledBackups(now = new Date()) {
  if (job) return;
  const { passphrase } = await getSettings('backup');
  if (!passphrase) return;
  for (const target of await listTargets()) {
    const type = dueBackup(target.schedule, target, now);
    if (!type) continue;
    job = { kind: 'backup', targetId: target.id, targetName: target.name, type, startedAt: new Date().toISOString(), progress: null };
    try {
      await runBackup(target, type, 'schedule', passphrase);
    } finally {
      job = null;
    }
    return;
  }
}

export async function listRuns(limit = 50) {
  return db.query.backupRuns.findMany({ orderBy: desc(schema.backupRuns.startedAt), limit });
}

/** The sets on a location, newest first, marked with whether this server can restore them. */
export async function remoteSets(targetId: string) {
  const target = await getTarget(targetId);
  const sets = await withStore(target, (store, root) => listSets(store, root));
  return sets.map((s) => ({ ...s, ownServer: s.hostname === hostname() }));
}

/** Saves the backup settings; a new passphrase starts a new chain on every location. */
export async function saveBackupSettings(input: { passphrase?: string | null; notifyOnFailure?: boolean }) {
  if (typeof input.passphrase === 'string' && input.passphrase && input.passphrase.length < 12) throw badRequest('errors.backupPassphraseShort');
  const before = await getSettings('backup');
  await saveSettings('backup', { notifyOnFailure: input.notifyOnFailure ?? before.notifyOnFailure, passphrase: input.passphrase === null ? null : input.passphrase || '' });
  const after = await getSettings('backup');
  if (after.passphrase !== before.passphrase) await db.update(schema.backupTargets).set({ lastManifest: null, lastFullAt: null });
}

// ── Restore ────────────────────────────────────────────────────────────────

function restoreError(err: unknown): AppError {
  if (err instanceof RestoreError) {
    const key = { notFound: 'errors.backupNotFound', wrongPassphrase: 'errors.backupWrongPassphrase', newerVersion: 'errors.backupNewer', damaged: 'errors.backupDamaged' } as const;
    return badRequest(key[err.code], err.params);
  }
  return connectError(err);
}

/**
 * Restores a set: checks the passphrase straight away, then downloads and checks everything
 * in the background and hands over to install/restore.sh (as root, through the updater unit),
 * which stops the service, swaps the database and data folder and starts it again.
 */
export async function startRestore(targetId: string, setId: string, passphraseOverride: string | undefined, requestedBy: string) {
  if (!SET_ID.test(setId)) throw notFound();
  if (job) throw badRequest('errors.backupBusy');
  if (!(await selfUpdateEnabled())) throw badRequest('errors.restoreUnavailable');
  const update = await readUpdateStatus();
  const fresh = update.updatedAt && Date.now() - new Date(update.updatedAt).getTime() < 30 * 60_000;
  if ((update.state === 'queued' || update.state === 'running') && fresh) throw badRequest('errors.updateRunning');
  const target = await getTarget(targetId);
  const passphrase = passphraseOverride || (await requirePassphrase());

  // Fails fast on a wrong passphrase or a backup from a newer version
  try {
    await withStore(target, (store, root) => readManifest(store, root, setId, passphrase));
  } catch (err) {
    throw restoreError(err);
  }

  job = { kind: 'restore', targetId: target.id, targetName: target.name, setId, startedAt: new Date().toISOString(), progress: null };
  await writeRestoreStatus({ state: 'preparing', code: 'preparing', setId, message: 'Downloading the backup' });
  (async () => {
    try {
      await withStore(target, (store, root) =>
        prepareRestore({
          store,
          root,
          setId,
          passphrase,
          staging: stagingDir,
          appVersion: config.version,
          onProgress: (p) => {
            if (job) job.progress = p;
          },
        }),
      );
      await writeRestoreStatus({ state: 'queued', code: 'queued', setId, message: 'Restore queued' });
      await requestRestore(setId, requestedBy);
    } catch (err) {
      await writeRestoreStatus({ state: 'failed', code: 'prepareFailed', setId, message: errorText(restoreError(err)) });
    } finally {
      job = null;
    }
  })();
}
