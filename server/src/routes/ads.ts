import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit, tenantScope } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { uuidParam } from '../lib/ids.js';
import { sentOnly } from '../lib/patch.js';
import { adStats, listAds } from '../services/ads.js';

const MAX_VIDEO = 25 * 1024 * 1024;
const VIDEO_TYPES = ['video/mp4', 'video/webm'];

export const adInput = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['image', 'video']),
  mediaId: z.string().uuid().nullable(),
  linkUrl: z
    .string()
    .trim()
    .regex(/^https?:\/\/\S+$/, 'errors.urlFormat')
    .nullable()
    .or(z.literal('').transform(() => null))
    .default(null),
  placement: z.enum(['before', 'after']),
  seconds: z.coerce.number().int().min(0).max(60).default(5),
  active: z.boolean().default(true),
  startsAt: z.coerce.date().nullable().default(null),
  endsAt: z.coerce.date().nullable().default(null),
});

/** An mp4 starts with an "ftyp" box, WebM with the EBML header. */
export const looksLikeVideo = (mime: string, b: Buffer) => (mime === 'video/mp4' ? b.subarray(4, 8).toString('latin1') === 'ftyp' : b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])));

async function checkMedia(tenantId: string, mediaId: string | null | undefined, kind: 'image' | 'video') {
  if (!mediaId) throw badRequest('errors.adMedia');
  const m = await db.query.media.findFirst({ where: and(eq(schema.media.id, mediaId), eq(schema.media.tenantId, tenantId)), columns: { mime: true } });
  if (!m || (kind === 'video') !== m.mime.startsWith('video/')) throw badRequest('errors.adMedia');
}

export async function adRoutes(app: FastifyInstance) {
  app.get('/api/ads', async (req) => {
    const tenantId = tenantScope(req);
    const [ads, stats] = await Promise.all([listAds(tenantId), adStats(tenantId)]);
    return { ads: ads.map((a) => ({ ...a, mediaUrl: a.mediaId ? `/portal/media/${a.mediaId}` : null, stats: stats[a.id] ?? { views: 0, clicks: 0, today: { views: 0, clicks: 0 }, days: [] } })) };
  });

  app.post('/api/ads', async (req) => {
    const tenantId = tenantScope(req, true);
    const input = adInput.parse(req.body);
    await checkMedia(tenantId, input.mediaId, input.kind);
    if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) throw badRequest('errors.adPeriod');
    const [ad] = await db.insert(schema.portalAds).values({ ...input, tenantId }).returning();
    await audit(req, 'ad.created', { name: ad.name }, tenantId);
    return { ad };
  });

  app.put<{ Params: { id: string } }>('/api/ads/:id', async (req) => {
    const tenantId = tenantScope(req, true);
    const id = uuidParam(req.params.id);
    const current = await db.query.portalAds.findFirst({ where: and(eq(schema.portalAds.id, id), eq(schema.portalAds.tenantId, tenantId)) });
    if (!current) throw notFound();
    const input = sentOnly(adInput.partial().parse(req.body), req.body);
    const next = { ...current, ...input };
    if (input.mediaId !== undefined || input.kind !== undefined) await checkMedia(tenantId, next.mediaId, next.kind);
    if (next.startsAt && next.endsAt && next.endsAt <= next.startsAt) throw badRequest('errors.adPeriod');
    const [ad] = await db.update(schema.portalAds).set(input).where(eq(schema.portalAds.id, id)).returning();
    // A replaced image or video is not used anywhere else
    if (current.mediaId && current.mediaId !== ad.mediaId) await db.delete(schema.media).where(eq(schema.media.id, current.mediaId)).catch(() => undefined);
    await audit(req, 'ad.updated', { name: ad.name }, tenantId);
    return { ad };
  });

  app.delete<{ Params: { id: string } }>('/api/ads/:id', async (req) => {
    const tenantId = tenantScope(req, true);
    const [ad] = await db.delete(schema.portalAds).where(and(eq(schema.portalAds.id, uuidParam(req.params.id)), eq(schema.portalAds.tenantId, tenantId))).returning();
    if (!ad) throw notFound();
    if (ad.mediaId) await db.delete(schema.media).where(eq(schema.media.id, ad.mediaId)).catch(() => undefined);
    await audit(req, 'ad.deleted', { name: ad.name }, tenantId);
    return { ok: true };
  });

  // Videos are sent as the raw file (not as a data URL like images), up to 25 MB
  await app.register(async (sub) => {
    for (const type of VIDEO_TYPES) sub.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: MAX_VIDEO + 1024 }, (_req, body, done) => done(null, body));
    sub.post('/api/media/video', { bodyLimit: MAX_VIDEO + 1024, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
      const tenantId = tenantScope(req, true);
      const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim();
      const data = req.body as Buffer;
      if (!VIDEO_TYPES.includes(mime) || !Buffer.isBuffer(data) || !looksLikeVideo(mime, data)) throw badRequest('errors.videoType');
      if (data.length > MAX_VIDEO) throw badRequest('errors.videoSize');
      const [row] = await db.insert(schema.media).values({ tenantId, mime, size: data.length, data }).returning({ id: schema.media.id });
      await audit(req, 'media.video_uploaded', { size: data.length }, tenantId);
      return { id: row.id, url: `/portal/media/${row.id}` };
    });
  });
}
