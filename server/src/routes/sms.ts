import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, tenantScope } from '../lib/auth.js';
import { sentOnly } from '../lib/patch.js';
import { smsConfigured, smsUsage, testSms } from '../services/sms.js';
import { getPublicTenantSettings, getTenantSettings, saveTenantSettings, smsSettingsSchema } from '../services/tenantSettings.js';

export async function smsRoutes(app: FastifyInstance) {
  app.get('/api/sms-settings', async (req) => {
    const tenantId = tenantScope(req);
    return { settings: await getPublicTenantSettings(tenantId, 'sms'), ready: smsConfigured(await getTenantSettings(tenantId, 'sms')), usage: await smsUsage(tenantId) };
  });

  app.put('/api/sms-settings', async (req) => {
    const tenantId = tenantScope(req, true);
    const input = sentOnly(smsSettingsSchema.partial().passthrough().parse(req.body), req.body) as Record<string, unknown>;
    await saveTenantSettings(tenantId, 'sms', input);
    await audit(req, 'sms.updated', undefined, tenantId);
    return { settings: await getPublicTenantSettings(tenantId, 'sms'), ready: smsConfigured(await getTenantSettings(tenantId, 'sms')) };
  });

  /** Sends a test text to the given number, with the form's values or what is stored. */
  app.post('/api/sms-settings/test', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const tenantId = tenantScope(req, true);
    const form = (req.body ?? {}) as Record<string, unknown>;
    const to = z.string().min(6).max(30).parse(form.to);
    const stored = await getTenantSettings(tenantId, 'sms');
    const filled = Object.fromEntries(Object.entries(form).filter(([k, v]) => k !== 'to' && typeof v === 'string' && v.trim() !== ''));
    const result = await testSms(smsSettingsSchema.parse({ ...stored, ...filled }), to);
    await audit(req, 'sms.tested', undefined, tenantId);
    return result;
  });
}
