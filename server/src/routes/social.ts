import type { FastifyInstance } from 'fastify';
import { audit, tenantScope } from '../lib/auth.js';
import { facebookRedirectUri, testFacebook } from '../services/facebook.js';
import { getPublicTenantSettings, getTenantSettings, saveTenantSettings, socialSettingsSchema } from '../services/tenantSettings.js';

export async function socialRoutes(app: FastifyInstance) {
  app.get('/api/social-settings', async (req) => {
    const tenantId = tenantScope(req);
    return { settings: await getPublicTenantSettings(tenantId, 'social'), facebookRedirectUri: await facebookRedirectUri(tenantId) };
  });

  app.put('/api/social-settings', async (req) => {
    const tenantId = tenantScope(req, true);
    const input = socialSettingsSchema.partial().passthrough().parse(req.body) as Record<string, unknown>;
    await saveTenantSettings(tenantId, 'social', input);
    await audit(req, 'social.updated', undefined, tenantId);
    return { settings: await getPublicTenantSettings(tenantId, 'social') };
  });

  app.post('/api/social-settings/test', async (req) => {
    const tenantId = tenantScope(req, true);
    const form = (req.body ?? {}) as Record<string, string>;
    const stored = await getTenantSettings(tenantId, 'social');
    return testFacebook(socialSettingsSchema.parse({ ...stored, facebookAppId: form.facebookAppId || stored.facebookAppId, facebookAppSecret: form.facebookAppSecret || stored.facebookAppSecret }));
  });
}
