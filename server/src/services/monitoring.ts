import { and, eq, isNotNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Console } from '../db/schema.js';
import type { Locale } from '../i18n/index.js';
import { deliver, formatDateTime } from './notifications.js';
import { adminBaseUrl } from './settings.js';
import { getTenantSettings } from './tenantSettings.js';

/**
 * Monitoring alerts: an e-mail when a console (or, when switched on, an access point) stays
 * offline longer than the customer's threshold, and a follow-up once it is back. Short blips
 * never reach anyone. Each outage is one notification, keyed by the device and the moment it went down.
 */

const outageRef = (id: string, since: Date) => `${id}:${since.getTime()}`;

export function durationText(locale: Locale, ms: number) {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  if (h < 48) return rest ? `${h} ${locale === 'nl' ? 'uur' : 'h'} ${rest} min` : `${h} ${locale === 'nl' ? 'uur' : 'h'}`;
  return `${Math.round(h / 24)} ${locale === 'nl' ? 'dagen' : 'days'}`;
}

const tenantName = async (tenantId: string) => (await db.query.tenants.findFirst({ where: eq(schema.tenants.id, tenantId) }))?.name ?? '';

async function wasAlerted(tenantId: string, kind: 'consoleOffline' | 'deviceOffline', ref: string) {
  const row = await db.query.notificationLog.findFirst({
    where: and(eq(schema.notificationLog.tenantId, tenantId), eq(schema.notificationLog.kind, kind), eq(schema.notificationLog.ref, ref)),
  });
  return row?.status === 'sent';
}

/** Sends the alerts for outages that passed the threshold; runs after every round of console checks. */
export async function runMonitoringAlerts(now = new Date()) {
  const actionUrl = `${await adminBaseUrl()}/consoles`;
  const consoles = await db.query.consoles.findMany({ where: isNotNull(schema.consoles.offlineSince) });
  for (const c of consoles) {
    const settings = await getTenantSettings(c.tenantId, 'notifications');
    if (!settings.consoleOffline || now.getTime() - c.offlineSince!.getTime() < settings.offlineMinutes * 60_000) continue;
    const name = await tenantName(c.tenantId);
    await deliver(c.tenantId, 'consoleOffline', outageRef(c.id, c.offlineSince!), (locale) => ({
      vars: { tenantName: name, consoleName: c.name, since: formatDateTime(locale, c.offlineSince!), error: c.lastError ?? '', actionUrl },
    }));
  }

  // Access points: only of consoles that answer, otherwise their state is not known
  const devices = await db
    .select({ device: schema.consoleDevices, siteName: schema.consoleSites.displayName })
    .from(schema.consoleDevices)
    .innerJoin(schema.consoleSites, eq(schema.consoleSites.id, schema.consoleDevices.consoleSiteId))
    .innerJoin(schema.consoles, eq(schema.consoles.id, schema.consoleSites.consoleId))
    .where(and(isNotNull(schema.consoleDevices.offlineSince), eq(schema.consoles.status, 'ok')));
  for (const { device: d, siteName } of devices) {
    const settings = await getTenantSettings(d.tenantId, 'notifications');
    if (!settings.deviceOffline || now.getTime() - d.offlineSince!.getTime() < settings.offlineMinutes * 60_000) continue;
    const name = await tenantName(d.tenantId);
    await deliver(d.tenantId, 'deviceOffline', outageRef(d.mac, d.offlineSince!), (locale) => ({
      vars: { tenantName: name, deviceName: d.name ?? d.mac, model: d.model ?? '', siteName, since: formatDateTime(locale, d.offlineSince!), actionUrl },
    }));
  }
}

/** Called when a console answers again: the "back online" e-mail, only if the outage was reported. */
export async function consoleRecovered(c: Console, since: Date) {
  const ref = outageRef(c.id, since);
  if (!(await wasAlerted(c.tenantId, 'consoleOffline', ref))) return;
  const name = await tenantName(c.tenantId);
  const actionUrl = `${await adminBaseUrl()}/consoles`;
  await deliver(c.tenantId, 'consoleOnline', ref, (locale) => ({
    vars: { tenantName: name, consoleName: c.name, since: formatDateTime(locale, since), downtime: durationText(locale, Date.now() - since.getTime()), actionUrl },
  }));
}

export async function deviceRecovered(tenantId: string, d: { mac: string; name: string | null; model: string | null; siteName: string; since: Date }) {
  const ref = outageRef(d.mac, d.since);
  if (!(await wasAlerted(tenantId, 'deviceOffline', ref))) return;
  const name = await tenantName(tenantId);
  const actionUrl = `${await adminBaseUrl()}/consoles`;
  await deliver(tenantId, 'deviceOnline', ref, (locale) => ({
    vars: { tenantName: name, deviceName: d.name ?? d.mac, model: d.model ?? '', siteName: d.siteName, since: formatDateTime(locale, d.since), downtime: durationText(locale, Date.now() - d.since.getTime()), actionUrl },
  }));
}
