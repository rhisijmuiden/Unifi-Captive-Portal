import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { hostname, uptime } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.js';
import { badRequest } from '../lib/errors.js';

const updateDir = join(config.dataDir, 'update');
const requestFile = join(updateDir, 'request.json');
const statusFile = join(updateDir, 'status.json');
const enabledFile = join(updateDir, 'enabled');

export type Channel = 'stable' | 'test';
export type Release = { version: string; name: string; notes: string; url: string; publishedAt: string | null; prerelease: boolean };

const isPrerelease = (v: string) => v.replace(/^v/, '').includes('-');

/** Semver-style comparison: 1.2.0-beta.2 < 1.2.0-rc.1 < 1.2.0 < 1.2.1. */
export function compareVersions(a: string, b: string) {
  const split = (v: string) => {
    const [core, pre = ''] = v.replace(/^v/, '').split(/-(.*)/s);
    return { core: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ? pre.split('.') : [] };
  };
  const pa = split(a);
  const pb = split(b);
  for (let i = 0; i < Math.max(pa.core.length, pb.core.length); i++) {
    const d = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (!pa.pre.length || !pb.pre.length) return Math.sign(pb.pre.length - pa.pre.length);
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = Number(x);
    const ny = Number(y);
    const d = Number.isNaN(nx) || Number.isNaN(ny) ? x.localeCompare(y) : nx - ny;
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

let cache: { at: number; releases: Release[] } | null = null;

async function github<T>(path: string): Promise<T | null> {
  const res = await fetch(`https://api.github.com/repos/${config.updateRepo}${path}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': `captive-portal/${config.version}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw badRequest('errors.githubStatus', { status: res.status });
  return (await res.json()) as T;
}

async function fetchReleases(): Promise<Release[]> {
  type GhRelease = { tag_name: string; name: string; body: string; html_url: string; published_at: string; draft: boolean; prerelease: boolean };
  const releases = ((await github<GhRelease[]>('/releases?per_page=50')) ?? []).filter((r) => !r.draft && /^v?\d+\.\d+\.\d+/.test(r.tag_name));
  if (releases.length) {
    return releases.map((r) => ({
      version: r.tag_name.replace(/^v/, ''),
      name: r.name || r.tag_name,
      notes: r.body ?? '',
      url: r.html_url,
      publishedAt: r.published_at,
      prerelease: r.prerelease || isPrerelease(r.tag_name),
    }));
  }
  // No GitHub releases yet: fall back to version tags
  const tags = (await github<{ name: string }[]>('/tags?per_page=100')) ?? [];
  return tags
    .filter((t) => /^v?\d+\.\d+\.\d+/.test(t.name))
    .map((t) => ({
      version: t.name.replace(/^v/, ''),
      name: t.name,
      notes: '',
      url: `https://github.com/${config.updateRepo}/releases/tag/${t.name}`,
      publishedAt: null,
      prerelease: isPrerelease(t.name),
    }));
}

/** Newest release in a channel. The test channel also sees stable releases, so it never lags behind. */
export function latestForChannel(releases: Release[], channel: Channel) {
  const eligible = releases.filter((r) => channel === 'test' || !r.prerelease);
  return eligible.sort((a, b) => compareVersions(b.version, a.version))[0] ?? null;
}

export async function checkForUpdates(channel: Channel, force = false) {
  if (force || !cache || Date.now() - cache.at > 10 * 60_000) cache = { at: Date.now(), releases: await fetchReleases() };
  const latest = latestForChannel(cache.releases, channel);
  return {
    current: config.version,
    channel,
    latest,
    updateAvailable: Boolean(latest && compareVersions(latest.version, config.version) > 0),
    checkedAt: new Date(cache.at).toISOString(),
  };
}

export async function selfUpdateEnabled() {
  return readFile(enabledFile).then(() => true, () => false);
}

export type UpdateStatus = { state: 'idle' | 'queued' | 'running' | 'success' | 'failed'; code?: string; version?: string; message?: string; log?: string; updatedAt?: string };

export async function readUpdateStatus(): Promise<UpdateStatus> {
  try {
    return JSON.parse(await readFile(statusFile, 'utf8')) as UpdateStatus;
  } catch {
    return { state: 'idle' };
  }
}

/**
 * Hands the update to the root-owned systemd path unit (captive-portal-updater.path),
 * which runs install/update.sh. The app itself never runs as root.
 */
export async function requestUpdate(version: string, includeSystem: boolean, requestedBy: string) {
  if (!(await selfUpdateEnabled())) throw badRequest('errors.selfUpdateDisabled');
  const status = await readUpdateStatus();
  // A request older than 30 minutes is considered stuck (e.g. the updater unit was stopped)
  const fresh = status.updatedAt && Date.now() - new Date(status.updatedAt).getTime() < 30 * 60_000;
  if ((status.state === 'queued' || status.state === 'running') && fresh) throw badRequest('errors.updateRunning');
  await mkdir(updateDir, { recursive: true });
  const now = new Date().toISOString();
  await writeFile(statusFile, JSON.stringify({ state: 'queued', code: 'queued', version, message: 'Update queued', updatedAt: now }));
  // update.sh only accepts a plain version string and a boolean from this file
  await writeFile(requestFile, JSON.stringify({ version, system: includeSystem, requestedBy, requestedAt: now }));
}

/**
 * Hands a prepared restore (restore/staging) to the same root-owned updater unit;
 * update.sh passes it on to install/restore.sh. Only the set id is taken from the request.
 */
export async function requestRestore(setId: string, requestedBy: string) {
  await mkdir(updateDir, { recursive: true });
  await writeFile(requestFile, JSON.stringify({ action: 'restore', setId, requestedBy, requestedAt: new Date().toISOString() }));
}

export function systemInfo() {
  return {
    version: config.version,
    node: process.version,
    hostname: hostname(),
    uptimeSeconds: Math.round(uptime()),
    processUptimeSeconds: Math.round(process.uptime()),
    repository: `https://github.com/${config.updateRepo}`,
  };
}
