import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { decrypt, encrypt } from '../lib/crypto.js';

/** Settings per customer, stored like the platform settings (secrets encrypted, never sent back). */

export const paymentSettingsSchema = z.object({
  provider: z.enum(['none', 'mollie', 'stripe']).default('none'),
  mollieApiKey: z.string().default(''),
  stripeSecretKey: z.string().default(''),
  stripeWebhookSecret: z.string().default(''),
  currency: z.enum(['EUR', 'USD', 'GBP', 'CHF']).default('EUR'),
  // Short internet access while the guest pays, so the payment page and banking app can load
  graceMinutes: z.coerce.number().int().min(0).max(30).default(10),
});

export const notificationSettingsSchema = z.object({
  hostnameLive: z.boolean().default(true),
  monthlyReport: z.boolean().default(true),
  // Monitoring: an e-mail when a console (or an access point) stays offline this long, and when it is back
  consoleOffline: z.boolean().default(true),
  deviceOffline: z.boolean().default(false),
  // A console that joins a linked Fabric but is not linked to the portal yet
  fabricConsoleFound: z.boolean().default(true),
  offlineMinutes: z.coerce.number().int().min(5).max(1440).default(10),
  // Customer admins get the notifications; extra addresses can be added
  notifyAdmins: z.boolean().default(true),
  recipients: z.array(z.string().email()).max(20).default([]),
});

export const socialSettingsSchema = z.object({
  // The customer's own Facebook app (developers.facebook.com), with Facebook Login
  facebookAppId: z.string().trim().regex(/^\d*$/, 'errors.facebookAppId').default(''),
  facebookAppSecret: z.string().default(''),
  // Short internet access so the sign-in page loads before the guest is connected (all providers)
  facebookGraceMinutes: z.coerce.number().int().min(0).max(15).default(5),
  // Google Cloud console: OAuth client of type "Web application"
  googleClientId: z.string().trim().max(200).default(''),
  googleClientSecret: z.string().default(''),
  // Microsoft Entra app registration; "common" lets work, school and personal accounts sign in
  microsoftClientId: z.string().trim().regex(/^([0-9a-f-]{36})?$/i, 'errors.microsoftClientId').default(''),
  microsoftClientSecret: z.string().default(''),
  microsoftTenant: z.string().trim().regex(/^[\w.-]{1,100}$/, 'errors.microsoftTenant').default('common'),
  // Apple Developer: a Services ID with "Sign in with Apple", plus a key (.p8) to sign the client secret
  appleServiceId: z.string().trim().max(200).default(''),
  appleTeamId: z.string().trim().regex(/^([A-Z0-9]{10})?$/, 'errors.appleTeamId').default(''),
  appleKeyId: z.string().trim().regex(/^([A-Z0-9]{10})?$/, 'errors.appleKeyId').default(''),
  applePrivateKey: z.string().default(''),
});

// Text messages for the SMS login, with the customer's own Twilio or MessageBird account
export const smsSettingsSchema = z.object({
  provider: z.enum(['none', 'twilio', 'messagebird']).default('none'),
  twilioAccountSid: z.string().trim().regex(/^(AC[0-9a-f]{32})?$/i, 'errors.twilioSid').default(''),
  twilioAuthToken: z.string().default(''),
  // A phone number in E.164, an alphanumeric sender, or a Messaging Service SID (MG…)
  twilioFrom: z.string().trim().max(34).default(''),
  messagebirdApiKey: z.string().default(''),
  messagebirdOriginator: z.string().trim().max(17).default(''),
  // Country code for numbers typed without one, e.g. 31 for "06 12345678"
  defaultCountry: z.string().trim().regex(/^[1-9]\d{0,2}$/, 'errors.countryCode').default('31'),
  // Protects the customer's SMS budget
  dailyLimit: z.coerce.number().int().min(1).max(100_000).default(500),
});

// Hotel login: room number + surname, from the customer's own list or a PMS
export const hotelSettingsSchema = z.object({
  source: z.enum(['manual', 'apaleo', 'mews']).default('manual'),
  // Departure dates without a time end at this local time
  checkoutTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'errors.timeFormat').default('12:00'),
  devicesPerRoom: z.coerce.number().int().min(1).max(50).default(5),
  apaleoClientId: z.string().trim().max(200).default(''),
  apaleoClientSecret: z.string().default(''),
  apaleoPropertyId: z.string().trim().max(20).default(''),
  mewsPlatformUrl: z.string().trim().regex(/^(https:\/\/[^\s/]+)?$/, 'errors.urlFormat').default('https://api.mews.com'),
  mewsClientToken: z.string().default(''),
  mewsAccessToken: z.string().default(''),
});

// Newsletter: guests who opted in are sent to the customer's Mailchimp audience or HubSpot
export const marketingSettingsSchema = z.object({
  provider: z.enum(['none', 'mailchimp', 'hubspot']).default('none'),
  // Mailchimp API key ends in the data centre, e.g. "…-us21"
  mailchimpApiKey: z.string().default(''),
  mailchimpAudienceId: z.string().trim().max(40).default(''),
  // Mailchimp sends its own confirmation e-mail first (double opt-in)
  mailchimpDoubleOptIn: z.boolean().default(false),
  // HubSpot private app with the crm.objects.contacts.write scope
  hubspotToken: z.string().default(''),
  autoSync: z.boolean().default(true),
  // Personal data of guests without opt-in is removed after this many days (0 = keep)
  retentionDays: z.coerce.number().int().min(0).max(3650).default(0),
});

const texts = z.record(z.string().regex(/^[a-z]{2}$/), z.string().max(300));

// A short question on the "connected" page, optionally followed by a Google review link
export const surveySettingsSchema = z.object({
  enabled: z.boolean().default(false),
  question: texts.default({}),
  allowComment: z.boolean().default(true),
  googleReviewUrl: z
    .string()
    .trim()
    .regex(/^(https:\/\/\S+)?$/, 'errors.urlFormat')
    .default(''),
  // Show the review button to every guest after answering (Google does not allow asking only happy guests)
  reviewButton: z.boolean().default(true),
});

// Two-factor sign-in for the customer's own team, on top of what the platform requires
export const securitySettingsSchema = z.object({
  require2fa: z.enum(['off', 'admins', 'all']).default('off'),
});

const definitions = {
  payments: { schema: paymentSettingsSchema, secrets: ['mollieApiKey', 'stripeSecretKey', 'stripeWebhookSecret'] },
  notifications: { schema: notificationSettingsSchema, secrets: [] },
  social: { schema: socialSettingsSchema, secrets: ['facebookAppSecret', 'googleClientSecret', 'microsoftClientSecret', 'applePrivateKey'] },
  sms: { schema: smsSettingsSchema, secrets: ['twilioAuthToken', 'messagebirdApiKey'] },
  hotel: { schema: hotelSettingsSchema, secrets: ['apaleoClientSecret', 'mewsClientToken', 'mewsAccessToken'] },
  security: { schema: securitySettingsSchema, secrets: [] },
  marketing: { schema: marketingSettingsSchema, secrets: ['mailchimpApiKey', 'hubspotToken'] },
  survey: { schema: surveySettingsSchema, secrets: [] },
} as const;

type Definitions = typeof definitions;
export type TenantSettingsKey = keyof Definitions;
export type TenantSettingsValue<K extends TenantSettingsKey> = z.infer<Definitions[K]['schema']>;

async function readRaw(tenantId: string, key: TenantSettingsKey): Promise<Record<string, unknown>> {
  const row = await db.query.tenantSettings.findFirst({ where: and(eq(schema.tenantSettings.tenantId, tenantId), eq(schema.tenantSettings.key, key)) });
  return (row?.value as Record<string, unknown>) ?? {};
}

export async function getTenantSettings<K extends TenantSettingsKey>(tenantId: string, key: K): Promise<TenantSettingsValue<K>> {
  const raw = { ...(await readRaw(tenantId, key)) };
  for (const field of definitions[key].secrets) {
    const v = raw[field];
    raw[field] = typeof v === 'string' && v ? decrypt(v) : '';
  }
  return definitions[key].schema.parse(raw) as TenantSettingsValue<K>;
}

export async function getPublicTenantSettings(tenantId: string, key: TenantSettingsKey) {
  const raw = await readRaw(tenantId, key);
  const secrets = definitions[key].secrets as readonly string[];
  const parsed = definitions[key].schema.parse({ ...raw, ...Object.fromEntries(secrets.map((s) => [s, ''])) });
  return { ...parsed, ...Object.fromEntries(secrets.map((s) => [`${s}Set`, Boolean(raw[s])])) };
}

/** Empty secret fields keep the stored value; null clears it. */
export async function saveTenantSettings(tenantId: string, key: TenantSettingsKey, input: Record<string, unknown>) {
  const current = await readRaw(tenantId, key);
  const secrets = definitions[key].secrets as readonly string[];
  const plain = Object.fromEntries(Object.entries(input).filter(([k]) => !secrets.includes(k)));
  const parsed = definitions[key].schema.parse({ ...current, ...plain, ...Object.fromEntries(secrets.map((s) => [s, ''])) });
  const value: Record<string, unknown> = { ...parsed };
  for (const field of secrets) {
    const incoming = input[field];
    if (incoming === null) value[field] = '';
    else if (typeof incoming === 'string' && incoming.trim() !== '') value[field] = encrypt(incoming.trim());
    else value[field] = current[field] ?? '';
  }
  await db
    .insert(schema.tenantSettings)
    .values({ tenantId, key, value })
    .onConflictDoUpdate({ target: [schema.tenantSettings.tenantId, schema.tenantSettings.key], set: { value, updatedAt: new Date() } });
}
