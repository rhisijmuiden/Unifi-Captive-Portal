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
  // Customer admins get the notifications; extra addresses can be added
  notifyAdmins: z.boolean().default(true),
  recipients: z.array(z.string().email()).max(20).default([]),
});

const definitions = {
  payments: { schema: paymentSettingsSchema, secrets: ['mollieApiKey', 'stripeSecretKey', 'stripeWebhookSecret'] },
  notifications: { schema: notificationSettingsSchema, secrets: [] },
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
