import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, requireSuperadmin } from '../lib/auth.js';
import { badRequest, translateError } from '../lib/errors.js';
import { entraRedirectUri } from '../services/entra.js';
import { clearHostnameCache } from '../services/hostnames.js';
import { clearSecurityCache } from '../services/twoFactor.js';
import { requestLocale } from '../i18n/index.js';
import { checkMailDns, dkimPublicKey, dkimRecordValue, domainOf, generateDkimKey, heloName } from '../services/mailDns.js';
import { sendMail } from '../services/mailer.js';
import { renderTemplate } from '../services/mailTemplates.js';
import { getPublicSettings, getSettings, saveSettings, smtpSchema, type SettingsKey } from '../services/settings.js';

const keys: SettingsKey[] = ['smtp', 'sso', 'system', 'hosting', 'billing', 'security'];

/** The SMTP form as typed, falling back to stored secrets for fields left empty. */
async function smtpFromForm(form: Record<string, unknown>) {
  const stored = await getSettings('smtp');
  return smtpSchema.parse({
    ...stored,
    ...form,
    password: (form.password as string) || stored.password,
    oauthClientSecret: (form.oauthClientSecret as string) || stored.oauthClientSecret,
    dkimPrivateKey: (form.dkimPrivateKey as string) || stored.dkimPrivateKey,
  });
}

/** Public SMTP settings plus what the admin must publish in DNS and the EHLO name in use. */
async function smtpExtras() {
  const s = await getSettings('smtp');
  const publicKey = s.dkimPrivateKey ? dkimPublicKey(s.dkimPrivateKey) : null;
  return {
    heloNameEffective: (await heloName(s)).name,
    dkimRecord:
      publicKey && s.dkimSelector && s.dkimDomain
        ? { type: 'TXT', name: `${s.dkimSelector}._domainkey.${s.dkimDomain}`, value: dkimRecordValue(publicKey) }
        : null,
  };
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get<{ Params: { key: string } }>('/api/settings/:key', async (req) => {
    requireSuperadmin(req);
    const key = req.params.key as SettingsKey;
    if (!keys.includes(key)) throw badRequest('errors.unknownSetting');
    const value = await getPublicSettings(key);
    if (key === 'smtp') return { ...value, ...(await smtpExtras()) };
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
    const value = await getPublicSettings(key);
    return key === 'smtp' ? { ...value, ...(await smtpExtras()) } : value;
  });

  // New DKIM key pair: the private key is stored encrypted, the public key goes in DNS
  app.post('/api/settings/smtp/dkim-key', async (req) => {
    requireSuperadmin(req);
    const { domain, selector } = z
      .object({ domain: z.string().optional(), selector: z.string().optional() })
      .parse(req.body ?? {});
    const stored = await getSettings('smtp');
    await saveSettings('smtp', {
      dkimEnabled: true,
      dkimDomain: domain || stored.dkimDomain || domainOf(stored.fromEmail),
      dkimSelector: selector || stored.dkimSelector || 'portal',
      dkimPrivateKey: generateDkimKey(),
    });
    await audit(req, 'smtp.dkim_key_generated', {}, null);
    return { ...(await getPublicSettings('smtp')), ...(await smtpExtras()) };
  });

  // Checks EHLO name, SPF, DKIM and DMARC for the settings as typed in the form
  app.post('/api/settings/smtp/check', async (req) => {
    requireSuperadmin(req);
    return checkMailDns(await smtpFromForm((req.body ?? {}) as Record<string, unknown>));
  });

  // Tests the settings as typed in the form, falling back to stored secrets
  app.post('/api/settings/smtp/test', async (req) => {
    requireSuperadmin(req);
    const { to, ...form } = z.object({ to: z.string().email() }).passthrough().parse(req.body);
    const merged = await smtpFromForm(form);
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
