import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, requireSuperadmin } from '../lib/auth.js';
import { badRequest } from '../lib/errors.js';
import { entraRedirectUri } from '../services/entra.js';
import { renderEmail, sendMail } from '../services/mailer.js';
import { getPublicSettings, getSettings, saveSettings, smtpSchema, type SettingsKey } from '../services/settings.js';

const keys: SettingsKey[] = ['smtp', 'sso', 'system'];

export async function settingsRoutes(app: FastifyInstance) {
  app.get<{ Params: { key: string } }>('/api/settings/:key', async (req) => {
    requireSuperadmin(req);
    const key = req.params.key as SettingsKey;
    if (!keys.includes(key)) throw badRequest('Onbekende instelling');
    const value = await getPublicSettings(key);
    return key === 'sso' ? { ...value, redirectUri: entraRedirectUri() } : value;
  });

  app.put<{ Params: { key: string } }>('/api/settings/:key', async (req) => {
    requireSuperadmin(req);
    const key = req.params.key as SettingsKey;
    if (!keys.includes(key)) throw badRequest('Onbekende instelling');
    await saveSettings(key, req.body as Record<string, unknown>);
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
      const info = await sendMail(to, 'Testbericht van het Captive Portal', renderEmail('Het werkt!', ['Dit is een testbericht. Je SMTP-instellingen zijn correct.']), merged);
      return { ok: true, messageId: info.messageId, response: info.response };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
}
