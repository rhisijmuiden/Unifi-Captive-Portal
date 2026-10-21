import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, tenantScope } from '../lib/auth.js';
import { sentOnly } from '../lib/patch.js';
import { testFacebook } from '../services/facebook.js';
import { oidcProviders, redirectUri, testOidc, walledGarden, type OidcProvider } from '../services/socialLogin.js';
import { getPublicTenantSettings, getTenantSettings, saveTenantSettings, socialSettingsSchema } from '../services/tenantSettings.js';

const providers = ['facebook', ...oidcProviders] as const;

async function redirectUris(tenantId: string) {
  return Object.fromEntries(await Promise.all(providers.map(async (p) => [p, await redirectUri(tenantId, p)] as const))) as Record<(typeof providers)[number], string>;
}

export async function socialRoutes(app: FastifyInstance) {
  app.get('/api/social-settings', async (req) => {
    const tenantId = tenantScope(req);
    const uris = await redirectUris(tenantId);
    return { settings: await getPublicTenantSettings(tenantId, 'social'), facebookRedirectUri: uris.facebook, redirectUris: uris, walledGarden };
  });

  app.put('/api/social-settings', async (req) => {
    const tenantId = tenantScope(req, true);
    const input = sentOnly(socialSettingsSchema.partial().passthrough().parse(req.body), req.body) as Record<string, unknown>;
    await saveTenantSettings(tenantId, 'social', input);
    await audit(req, 'social.updated', undefined, tenantId);
    return { settings: await getPublicTenantSettings(tenantId, 'social') };
  });

  /** Checks one provider with the form's values, falling back to what is stored. */
  app.post('/api/social-settings/test', async (req) => {
    const tenantId = tenantScope(req, true);
    const form = (req.body ?? {}) as Record<string, unknown>;
    const provider = z.enum(providers).catch('facebook').parse(form.provider);
    const stored = await getTenantSettings(tenantId, 'social');
    const filled = Object.fromEntries(Object.entries(form).filter(([k, v]) => k !== 'provider' && typeof v === 'string' && v.trim() !== ''));
    const merged = socialSettingsSchema.parse({ ...stored, ...filled });
    return provider === 'facebook' ? testFacebook(merged) : testOidc(tenantId, merged, provider as OidcProvider);
  });
}
