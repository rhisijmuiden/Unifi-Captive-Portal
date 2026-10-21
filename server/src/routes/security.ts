import { and, count, eq, isNotNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db, schema } from '../db/index.js';
import { audit, tenantScope } from '../lib/auth.js';
import { getSettings } from '../services/settings.js';
import { getPublicTenantSettings, saveTenantSettings, securitySettingsSchema } from '../services/tenantSettings.js';
import { clearSecurityCache } from '../services/twoFactor.js';

/** The customer's own two-factor policy for their team (the platform's policy always applies as well). */
export async function securityRoutes(app: FastifyInstance) {
  app.get('/api/security-settings', async (req) => {
    const tenantId = tenantScope(req);
    const [settings, platform, [members], [enrolled]] = await Promise.all([
      getPublicTenantSettings(tenantId, 'security'),
      getSettings('security'),
      db.select({ value: count() }).from(schema.users).where(eq(schema.users.tenantId, tenantId)),
      db.select({ value: count() }).from(schema.users).where(and(eq(schema.users.tenantId, tenantId), isNotNull(schema.users.totpEnabledAt))),
    ]);
    return { settings, platform: { requireCustomers: platform.requireCustomers, trustMicrosoft: platform.trustMicrosoft }, members: members.value, enrolled: enrolled.value };
  });

  app.put('/api/security-settings', async (req) => {
    const tenantId = tenantScope(req, true);
    const input = securitySettingsSchema.partial().parse(req.body);
    await saveTenantSettings(tenantId, 'security', input);
    clearSecurityCache();
    await audit(req, 'security.updated', input, tenantId);
    return { settings: await getPublicTenantSettings(tenantId, 'security') };
  });
}
