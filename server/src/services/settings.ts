import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { decrypt, encrypt } from '../lib/crypto.js';

export const smtpSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().default(''),
  port: z.coerce.number().int().min(1).max(65535).default(587),
  // starttls = upgrade on 587 (required, never falls back to plain), tls = implicit TLS on 465
  security: z.enum(['starttls', 'tls', 'none']).default('starttls'),
  minTlsVersion: z.enum(['TLSv1.2', 'TLSv1.3']).default('TLSv1.2'),
  verifyCertificate: z.boolean().default(true),
  authMethod: z.enum(['none', 'password', 'oauth2']).default('password'),
  username: z.string().default(''),
  password: z.string().default(''),
  // OAuth2 client credentials, e.g. Microsoft 365 (scope https://outlook.office365.com/.default)
  oauthTokenUrl: z.string().default(''),
  oauthClientId: z.string().default(''),
  oauthClientSecret: z.string().default(''),
  oauthScope: z.string().default('https://outlook.office365.com/.default'),
  fromName: z.string().default('Captive Portal'),
  fromEmail: z.string().default(''),
  replyTo: z.string().default(''),
  dkimEnabled: z.boolean().default(false),
  dkimDomain: z.string().default(''),
  dkimSelector: z.string().default(''),
  dkimPrivateKey: z.string().default(''),
});

export const ssoSchema = z.object({
  entraEnabled: z.boolean().default(false),
  entraTenantId: z.string().default(''),
  entraClientId: z.string().default(''),
  entraClientSecret: z.string().default(''),
  // Hide the password form once SSO works; superadmins can always fall back via ?local=1
  allowLocalLogin: z.boolean().default(true),
  buttonLabel: z.string().default('Inloggen met Microsoft'),
});

export const systemSchema = z.object({
  // stable = normal releases only; test = also pre-releases (e.g. 1.2.0-beta.1)
  updateChannel: z.enum(['stable', 'test']).default('stable'),
});

const definitions = {
  smtp: { schema: smtpSchema, secrets: ['password', 'oauthClientSecret', 'dkimPrivateKey'] },
  sso: { schema: ssoSchema, secrets: ['entraClientSecret'] },
  system: { schema: systemSchema, secrets: [] },
} as const;

type Definitions = typeof definitions;
export type SettingsKey = keyof Definitions;
export type SettingsValue<K extends SettingsKey> = z.infer<Definitions[K]['schema']>;

async function readRaw(key: SettingsKey): Promise<Record<string, unknown>> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
  return (row?.value as Record<string, unknown>) ?? {};
}

/** Full settings with secrets decrypted, for internal use only. */
export async function getSettings<K extends SettingsKey>(key: K): Promise<SettingsValue<K>> {
  const raw = { ...(await readRaw(key)) };
  for (const field of definitions[key].secrets) {
    const v = raw[field];
    raw[field] = typeof v === 'string' && v ? decrypt(v) : '';
  }
  return definitions[key].schema.parse(raw) as SettingsValue<K>;
}

/** Settings safe to send to the browser: secrets replaced by a "set" flag. */
export async function getPublicSettings(key: SettingsKey) {
  const raw = await readRaw(key);
  const parsed = definitions[key].schema.parse({ ...raw, ...Object.fromEntries(definitions[key].secrets.map((s) => [s, ''])) });
  const flags = Object.fromEntries(definitions[key].secrets.map((s) => [`${s}Set`, Boolean(raw[s])]));
  return { ...parsed, ...flags };
}

/** Saves settings. Empty secret fields keep the stored value; send null to clear one. */
export async function saveSettings(key: SettingsKey, input: Record<string, unknown>) {
  const current = await readRaw(key);
  const secrets = definitions[key].secrets as readonly string[];
  const plainInput = Object.fromEntries(
    Object.entries(input).filter(([k]) => !secrets.includes(k)),
  );
  const parsed = definitions[key].schema.parse({ ...current, ...plainInput, ...Object.fromEntries(secrets.map((s) => [s, ''])) });
  const value: Record<string, unknown> = { ...parsed };
  for (const field of secrets) {
    const incoming = input[field];
    if (incoming === null) value[field] = '';
    else if (typeof incoming === 'string' && incoming !== '') value[field] = encrypt(incoming);
    else value[field] = current[field] ?? '';
  }
  await db
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
}
