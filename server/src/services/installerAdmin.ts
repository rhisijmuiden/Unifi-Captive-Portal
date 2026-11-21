import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { asc, eq, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import type { User } from '../db/schema.js';
import { generatePassword, hashPassword } from '../lib/crypto.js';

/**
 * The installer (and the Proxmox template on its first boot) creates the main administrator with a
 * generated password and shows it on the server console. Until that admin picks their own password,
 * the details live in DATA_DIR/initial-admin.json; DATA_DIR/console.issue is the console banner
 * (linked from /etc/issue.d and the login message), which loses the password once it is changed.
 */
export const INSTALLER_USERNAME = 'admin';
const credentialsFile = () => join(config.dataDir, 'initial-admin.json');
const issueFile = () => join(config.dataDir, 'console.issue');

export interface InstallerCredentials {
  userId: string;
  username: string;
  password: string;
  createdAt: string;
}

/** An account made by the installer signs in with a username instead of an e-mail address. */
export const isInstallerAccount = (user: Pick<User, 'email' | 'role'>) => user.role === 'superadmin' && !user.email.includes('@');

async function writeAtomic(path: string, content: string, mode: number) {
  await mkdir(config.dataDir, { recursive: true });
  await writeFile(`${path}.tmp`, content, { mode });
  await rename(`${path}.tmp`, path);
}

export async function readInstallerCredentials(): Promise<InstallerCredentials | null> {
  try {
    return JSON.parse(await readFile(credentialsFile(), 'utf8')) as InstallerCredentials;
  } catch {
    return null;
  }
}

/** Addresses the web interface is reachable on; agetty fills in \4 with the current IPv4 address. */
export function consoleUrls(publicUrl = config.publicUrl, port = config.port) {
  const local = `http://\\4:${port}`;
  let host = '';
  try {
    host = new URL(publicUrl).hostname;
  } catch {
    /* ignore */
  }
  // A PUBLIC_URL with an IP address or localhost says nothing the live address does not
  const named = host && !/^[\d.]+$/.test(host) && host !== 'localhost' && !host.includes(':');
  return named ? [publicUrl, local] : [local];
}

/** The console banner (an agetty issue file): plain English, the server console has no language setting. */
export function consoleIssue(creds: Pick<InstallerCredentials, 'username' | 'password'> | null, version = config.version) {
  const line = '-'.repeat(60);
  const out = ['', line, `  Captive Portal ${version} (RHIS)`, line, ''];
  const [first, ...rest] = consoleUrls();
  out.push(`  Web interface : ${first}`);
  for (const url of rest) out.push(`                  ${url}`);
  if (creds) {
    out.push(`  Username      : ${creds.username}`, `  Password      : ${creds.password}`, '');
    out.push('  Sign in and choose your own password; all further', '  configuration happens in the web interface.');
  } else {
    out.push('', '  Forgot the admin password? Sign in here as root and run:', '    captive-portal-admin reset-password');
  }
  out.push(line, '', '');
  return out.join('\n');
}

export async function writeConsoleIssue(creds: InstallerCredentials | null) {
  await writeAtomic(issueFile(), consoleIssue(creds), 0o644);
}

async function storeCredentials(user: User, password: string) {
  const creds: InstallerCredentials = { userId: user.id, username: user.email, password, createdAt: new Date().toISOString() };
  await writeAtomic(credentialsFile(), `${JSON.stringify(creds, null, 2)}\n`, 0o600);
  await writeConsoleIssue(creds);
  return creds;
}

/**
 * Creates the main administrator when the platform has no users yet. Returns null when users exist
 * (the console banner is refreshed then, so it never shows a stale password).
 */
export async function createInstallerAdmin(locale: string | null = null) {
  const password = generatePassword();
  const passwordHash = await hashPassword(password);
  const user = await db.transaction(async (tx) => {
    await tx.execute(sql`lock table users in exclusive mode`);
    const existing = await tx.select({ id: schema.users.id }).from(schema.users).limit(1);
    if (existing.length) return null;
    const [created] = await tx
      .insert(schema.users)
      .values({ name: 'Administrator', email: INSTALLER_USERNAME, passwordHash, role: 'superadmin', mustChangePassword: true, locale })
      .returning();
    return created;
  });
  if (!user) {
    await writeConsoleIssue(await stillValid());
    return null;
  }
  return storeCredentials(user, password);
}

/** Gives a main administrator a new generated password, e.g. after a lock-out. Signs them out everywhere. */
export async function resetAdminPassword(login?: string) {
  const user = login
    ? await db.query.users.findFirst({ where: eq(schema.users.email, login.toLowerCase().trim()) })
    : await db.query.users.findFirst({ where: eq(schema.users.role, 'superadmin'), orderBy: asc(schema.users.createdAt) });
  if (!user) throw new Error(login ? `No user "${login}"` : 'No main administrator found');
  if (user.role !== 'superadmin') throw new Error(`${user.email} is not a main administrator`);
  const password = generatePassword();
  await db.update(schema.users).set({ passwordHash: await hashPassword(password), mustChangePassword: true, isActive: true }).where(eq(schema.users.id, user.id));
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
  return storeCredentials(user, password);
}

/** The stored details, as long as they belong to an existing account that still has to change its password. */
async function stillValid() {
  const creds = await readInstallerCredentials();
  if (!creds) return null;
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, creds.userId) });
  return user?.mustChangePassword ? { ...creds, username: user.email } : null;
}

/** Called after a password change: once the admin has their own password the console stops showing it. */
export async function clearInstallerCredentials(userId: string) {
  const creds = await readInstallerCredentials();
  if (!creds || creds.userId !== userId) return;
  await rm(credentialsFile(), { force: true });
  await writeConsoleIssue(null);
}

/** Re-renders the banner, e.g. after an update or a change of PUBLIC_URL. */
export async function refreshConsoleIssue() {
  await writeConsoleIssue(await stillValid());
}
