import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { audit, requireUser, tenantScope } from '../lib/auth.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { designFor, getPortalSettings } from '../services/guests.js';
import { portalDesignSchema } from '../services/portalDesign.js';

const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};
const MAX_IMAGE = 2 * 1024 * 1024;

/** Checks the file really is the image type it claims (magic bytes), so nothing else gets served as an image. */
function sniff(mime: string, buf: Buffer) {
  const hex = buf.subarray(0, 12).toString('hex');
  if (mime === 'image/png') return hex.startsWith('89504e47');
  if (mime === 'image/jpeg') return hex.startsWith('ffd8ff');
  if (mime === 'image/gif') return hex.startsWith('47494638');
  if (mime === 'image/webp') return hex.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP';
  if (mime === 'image/svg+xml') return /<svg[\s>]/i.test(buf.subarray(0, 2048).toString('utf8'));
  return false;
}

export async function editorRoutes(app: FastifyInstance) {
  app.get('/api/portal-design', async (req) => {
    const tenantId = tenantScope(req);
    const p = await getPortalSettings(tenantId);
    return { design: designFor(p), custom: Boolean(p.design), languages: p.languages, auth: p.auth, requireTerms: p.requireTerms, terms: p.terms };
  });

  app.put('/api/portal-design', { bodyLimit: 512_000 }, async (req) => {
    const tenantId = tenantScope(req, true);
    const design = portalDesignSchema.parse((req.body as { design?: unknown })?.design);
    await db
      .insert(schema.portalSettings)
      .values({ tenantId, design, accentColor: design.theme.accent })
      .onConflictDoUpdate({ target: schema.portalSettings.tenantId, set: { design, accentColor: design.theme.accent, updatedAt: new Date() } });
    await audit(req, 'portal.design.updated', undefined, tenantId);
    return { design };
  });

  // Images for portal designs and e-mail templates, sent as a data URL
  app.post('/api/media', { bodyLimit: 3 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const user = requireUser(req);
    let tenantId: string | null = null;
    if (user.role === 'superadmin') tenantId = null;
    else if (user.role === 'tenant_admin') tenantId = user.tenantId;
    // Reseller logos are not tied to one customer
    else if (user.role === 'reseller_admin') tenantId = null;
    else throw forbidden();
    const { dataUrl } = z.object({ dataUrl: z.string().max(3 * 1024 * 1024) }).parse(req.body);
    const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m || !IMAGE_TYPES[m[1]]) throw badRequest('errors.imageType');
    const data = Buffer.from(m[2], 'base64');
    if (data.length > MAX_IMAGE) throw badRequest('errors.imageSize');
    if (!sniff(m[1], data)) throw badRequest('errors.imageType');
    const [row] = await db.insert(schema.media).values({ tenantId, mime: m[1], size: data.length, data }).returning({ id: schema.media.id });
    return { id: row.id, url: `/portal/media/${row.id}` };
  });
}
