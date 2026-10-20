import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { isValidHostname, normalizeHostname } from '../lib/hostname.js';

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
  // Empty = translated default in the visitor's language
  buttonLabel: z.string().default(''),
});

export const systemSchema = z.object({
  // stable = normal releases only; test = also pre-releases (e.g. 1.2.0-beta.1)
  updateChannel: z.enum(['stable', 'test']).default('stable'),
});

export const hostingSchema = z.object({
  // The address customers point their A/AAAA records at
  publicIpv4: z.union([z.ipv4(), z.literal('')]).default(''),
  publicIpv6: z.union([z.ipv6(), z.literal('')]).default(''),
  // Own hostname for the admin panel, served over HTTPS by Caddy like the guest portals
  adminHostname: z
    .string()
    .transform(normalizeHostname)
    .refine((v) => !v || isValidHostname(v), 'errors.hostnameFormat')
    .default(''),
  forceHttps: z.boolean().default(true),
});

const mediaUrl = z.string().regex(/^\/portal\/media\/[0-9a-f-]{36}$/).nullable();

/** Billing customers for their portal: the platform's company details, invoices and online payment. */
export const billingSchema = z.object({
  companyName: z.string().trim().max(200).default(''),
  address: z.string().max(1000).default(''),
  email: z.union([z.email(), z.literal('')]).default(''),
  phone: z.string().trim().max(60).default(''),
  website: z.string().trim().max(200).default(''),
  vatNumber: z.string().trim().max(40).default(''),
  // Chamber of Commerce (KvK) number
  cocNumber: z.string().trim().max(40).default(''),
  iban: z.string().trim().max(40).default(''),
  bic: z.string().trim().max(20).default(''),
  logo: mediaUrl.default(null),
  currency: z.enum(['EUR', 'USD', 'GBP', 'CHF']).default('EUR'),
  defaultVatRateBp: z.coerce.number().int().min(0).max(10_000).default(2100),
  paymentTermDays: z.coerce.number().int().min(0).max(120).default(14),
  // {year} is replaced by the year of the invoice date, so numbering restarts every year
  numberPrefix: z.string().trim().max(20).regex(/^[\w{}\-/.]*$/, 'errors.numberPrefix').default('{year}-'),
  numberDigits: z.coerce.number().int().min(1).max(8).default(4),
  footer: z.string().max(1000).default(''),
  // New subscription invoices are issued and e-mailed straight away; otherwise they wait as drafts
  autoSend: z.boolean().default(true),
  provider: z.enum(['none', 'mollie', 'stripe']).default('none'),
  mollieApiKey: z.string().default(''),
  stripeSecretKey: z.string().default(''),
  stripeWebhookSecret: z.string().default(''),
  // Reminders this many days after the due date
  reminders: z.boolean().default(true),
  reminderDays: z.array(z.coerce.number().int().min(1).max(365)).max(5).default([7, 14]),
  // Pause the customer's guest portal when an invoice is this many days overdue
  autoSuspend: z.boolean().default(false),
  suspendAfterDays: z.coerce.number().int().min(1).max(365).default(30),
});

/** Backups: the passphrase every backup is encrypted with, and the SSH key for SCP locations. */
export const backupSchema = z.object({
  passphrase: z.string().default(''),
  notifyOnFailure: z.boolean().default(true),
  sshPrivateKey: z.string().default(''),
  sshPublicKey: z.string().default(''),
});

const definitions = {
  smtp: { schema: smtpSchema, secrets: ['password', 'oauthClientSecret', 'dkimPrivateKey'] },
  sso: { schema: ssoSchema, secrets: ['entraClientSecret'] },
  system: { schema: systemSchema, secrets: [] },
  hosting: { schema: hostingSchema, secrets: [] },
  billing: { schema: billingSchema, secrets: ['mollieApiKey', 'stripeSecretKey', 'stripeWebhookSecret'] },
  backup: { schema: backupSchema, secrets: ['passphrase', 'sshPrivateKey'] },
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

/** Base URL for links in e-mails and SSO: the admin hostname (HTTPS through Caddy) once it is set, else PUBLIC_URL. */
export async function adminBaseUrl() {
  const { adminHostname } = await getSettings('hosting');
  return adminHostname ? `https://${adminHostname}` : config.publicUrl;
}
