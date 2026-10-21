import { and, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { PortalAd } from '../db/schema.js';
import { TIME_ZONE } from './reports.js';

/**
 * Adverts on the guest portal. "before": a splash image or video the guest sees before the
 * sign-in page, with "Continue" after a few seconds (pure CSS, no JavaScript). "after": on
 * the "connected" page, where the guest is online and a link can be followed.
 * Views and clicks are counted per day.
 */

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** A random running advert for this place on the portal, or null. */
export async function pickAd(tenantId: string, placement: 'before' | 'after', now = new Date()): Promise<PortalAd | null> {
  const a = schema.portalAds;
  const ads = await db.query.portalAds.findMany({
    where: and(eq(a.tenantId, tenantId), eq(a.placement, placement), eq(a.active, true), sql`${a.mediaId} is not null`, or(isNull(a.startsAt), lte(a.startsAt, now)), or(isNull(a.endsAt), gte(a.endsAt, now))),
  });
  return ads.length ? ads[Math.floor(Math.random() * ads.length)] : null;
}

export async function countAd(adId: string, what: 'views' | 'clicks') {
  const s = schema.adStats;
  await db
    .insert(s)
    .values({ adId, day: today(), views: what === 'views' ? 1 : 0, clicks: what === 'clicks' ? 1 : 0 })
    .onConflictDoUpdate({ target: [s.adId, s.day], set: what === 'views' ? { views: sql`${s.views} + 1` } : { clicks: sql`${s.clicks} + 1` } });
}

/** Totals, today and the last 30 days per advert. */
export async function adStats(tenantId: string) {
  const rows = await db.execute(sql`
    select s.ad_id, s.day::text as day, s.views, s.clicks from ad_stats s join portal_ads a on a.id = s.ad_id
    where a.tenant_id = ${tenantId} and s.day > (now() at time zone ${TIME_ZONE})::date - 30 order by s.day`);
  const totals = await db.execute(sql`
    select s.ad_id, sum(s.views)::int as views, sum(s.clicks)::int as clicks from ad_stats s join portal_ads a on a.id = s.ad_id
    where a.tenant_id = ${tenantId} group by s.ad_id`);
  const t = today();
  const out: Record<string, { views: number; clicks: number; today: { views: number; clicks: number }; days: { day: string; views: number; clicks: number }[] }> = {};
  for (const r of totals.rows as { ad_id: string; views: number; clicks: number }[]) out[r.ad_id] = { views: r.views, clicks: r.clicks, today: { views: 0, clicks: 0 }, days: [] };
  for (const r of rows.rows as { ad_id: string; day: string; views: number; clicks: number }[]) {
    const o = out[r.ad_id];
    if (!o) continue;
    o.days.push({ day: r.day, views: Number(r.views), clicks: Number(r.clicks) });
    if (r.day === t) o.today = { views: Number(r.views), clicks: Number(r.clicks) };
  }
  return out;
}

export const listAds = (tenantId: string) => db.query.portalAds.findMany({ where: eq(schema.portalAds.tenantId, tenantId), orderBy: [desc(schema.portalAds.createdAt)] });
