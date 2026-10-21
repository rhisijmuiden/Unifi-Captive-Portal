import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, requireSuperadmin } from '../lib/auth.js';
import { badRequest, translateError } from '../lib/errors.js';
import { entraRedirectUri } from '../services/entra.js';
import { clearHostnameCache } from '../services/hostnames.js';
import { clearSecurityCache } from '../services/twoFactor.js';
import { requestLocale } from '../i18n/index.js';
import { sendMail } from '../services/mailer.js';
import { renderTemplate } from '../services/mailTemplates.js';
import { getPublicSettings, getSettings, saveSettings, smtpSchema, type SettingsKey } from '../services/settings.js';

const keys: SettingsKey[] = ['smtp', 'sso', 'system', 'hosting', 'billing', 'security'];

export async function settingsRoutes(app: FastifyInstance) {
  app.get<{ Params: { key: string } }>('/api/settings/:key', async (req) => {
    requireSuperadmin(req);
    const key = req.params.key as SettingsKey;
    if (!keys.includes(key)) throw badRequest('errors.unknownSetting');
    const value = await getPublicSettings(key);
    return key === 'sso' ? { ...value, redirectUri: await entraRedirectUri() } : value;
  });

  app.put<{ Params: { key: string } }>('/api/settings/:key', async (req) => {
    requireSuperadmin(req);
    const key = req.params.key as SettingsKey;
    if (!keys.includes(key)) throw badRequest('errors.unknownSetting');
    await saveSettings(key, req.body as Record<string, unknown>);
    if (key === 'hosting') clearHostnameCache();
    if (key === 'security') clearSecurityCache();
    await audit(req, 'settings.updated', { key }, null);
    return getPublicSettings(key);
  });

  // Tests the settings as typed in the form, falling back to stored secrets
  app.post('/api/settings/smtp/test', async (req) => {
    requireSuperadmin(req);
    const { to, ...form } = z.object({ to: z.string().email() }).passthrough().parse(req.body);
    const stored = await getSettings('smtp');
    const merged = smtpSchema.parse({
      ...stored,
      ...form,
      password: (form.password as string) || stored.password,
      oauthClientSecret: (form.oauthClientSecret as string) || stored.oauthClientSecret,
      dkimPrivateKey: (form.dkimPrivateKey as string) || stored.dkimPrivateKey,
    });
    try {
      const locale = requestLocale(req);
      const { subject, html, text } = await renderTemplate('smtpTest', locale, null, { vars: {} });
      const info = await sendMail(to, subject, { html, text }, merged);
      return { ok: true, messageId: info.messageId, response: info.response };
    } catch (err) {
      return { ok: false, error: translateError(err, requestLocale(req)) };
    }
  });
}
