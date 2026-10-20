import { boolean, customType, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { MailDesign } from '../shared/mailDesign.js';
import type { FieldMode, LoginMethod, PortalDesign } from '../shared/portalDesign.js';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const userRole = pgEnum('user_role', ['superadmin', 'tenant_admin', 'tenant_user']);
export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended']);
export const tokenPurpose = pgEnum('token_purpose', ['invite', 'password_reset']);

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  contactEmail: text('contact_email'),
  status: tenantStatus('status').notNull().default('active'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    role: userRole('role').notNull(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active').notNull().default(true),
    entraOid: text('entra_oid').unique(),
    // Preferred language for the interface and e-mails (null = follow the browser)
    locale: text('locale'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('users_tenant_idx').on(t.tenantId)],
);

export const sessions = pgTable('sessions', {
  // sha256 of the cookie token; the raw token is never stored
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userTokens = pgTable('user_tokens', {
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  purpose: tokenPurpose('purpose').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    details: jsonb('details'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_created_idx').on(t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Tenant = typeof tenants.$inferSelect;

// ── UniFi consoles and guest portal ──────────────────────────────────────────

export const consoleConnection = pgEnum('console_connection', ['site_manager', 'direct']);
export const healthStatus = pgEnum('health_status', ['unknown', 'ok', 'error']);
export const hostnameStatus = pgEnum('hostname_status', ['pending', 'dns_ok', 'active', 'error']);
export const guestStatus = pgEnum('guest_status', ['pending', 'authorized', 'failed']);

export const consoles = pgTable('consoles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  connection: consoleConnection('connection').notNull(),
  // Site Manager host id (connection = site_manager)
  hostId: text('host_id'),
  // https://<console-address> (connection = direct)
  baseUrl: text('base_url'),
  apiKey: text('api_key').notNull(),
  verifyTls: boolean('verify_tls').notNull().default(true),
  status: healthStatus('status').notNull().default('unknown'),
  lastError: text('last_error'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const consoleSites = pgTable(
  'console_sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    consoleId: uuid('console_id')
      .notNull()
      .references(() => consoles.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    unifiSiteId: text('unifi_site_id').notNull(),
    // The short site name UniFi puts in the redirect path (/guest/s/<siteName>/)
    siteName: text('site_name').notNull(),
    displayName: text('display_name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [uniqueIndex('console_sites_unique').on(t.consoleId, t.unifiSiteId), index('console_sites_name_idx').on(t.siteName)],
);

export const consoleDevices = pgTable('console_devices', {
  // Lower-case MAC with colons; access points identify the customer when a guest is redirected
  mac: text('mac').primaryKey(),
  consoleSiteId: uuid('console_site_id')
    .notNull()
    .references(() => consoleSites.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name'),
  model: text('model'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const hostnames = pgTable('hostnames', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  hostname: text('hostname').notNull().unique(),
  status: hostnameStatus('status').notNull().default('pending'),
  lastError: text('last_error'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PortalAuth = {
  methods: LoginMethod[];
  emailName: FieldMode;
  emailPhone: FieldMode;
  marketingOptIn: boolean;
  welcomeMail: boolean;
  paymentEmail: FieldMode;
};
export const defaultPortalAuth: PortalAuth = {
  methods: ['free'],
  emailName: 'optional',
  emailPhone: 'off',
  marketingOptIn: false,
  welcomeMail: false,
  paymentEmail: 'required',
};

export const portalSettings = pgTable('portal_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  // Texts per language, e.g. { nl: '…', en: '…' }
  title: jsonb('title').$type<Record<string, string>>().notNull().default({}),
  welcome: jsonb('welcome').$type<Record<string, string>>().notNull().default({}),
  terms: jsonb('terms').$type<Record<string, string>>().notNull().default({}),
  accentColor: text('accent_color').notNull().default('#FF6B57'),
  requireTerms: boolean('require_terms').notNull().default(true),
  timeLimitMinutes: integer('time_limit_minutes').notNull().default(480),
  dataLimitMb: integer('data_limit_mb'),
  downKbps: integer('down_kbps'),
  upKbps: integer('up_kbps'),
  successUrl: text('success_url'),
  // Visual design from the portal editor; null = the default template with the texts above
  design: jsonb('design').$type<PortalDesign>(),
  // How guests get access and what the e-mail registration asks
  auth: jsonb('auth').$type<PortalAuth>().notNull().default(defaultPortalAuth),
  // Languages offered on the guest portal; the first one is used when the guest's language is not offered
  languages: jsonb('languages').$type<string[]>().notNull().default(['en', 'nl']),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const guestSessions = pgTable(
  'guest_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Random token in the portal URL; the guest never sees internal ids
    token: text('token').notNull().unique(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    consoleSiteId: uuid('console_site_id').references(() => consoleSites.id, { onDelete: 'set null' }),
    clientMac: text('client_mac').notNull(),
    apMac: text('ap_mac'),
    ssid: text('ssid'),
    originalUrl: text('original_url'),
    status: guestStatus('status').notNull().default('pending'),
    error: text('error'),
    locale: text('locale'),
    // How the guest got access and what they entered
    method: text('method').$type<LoginMethod>(),
    name: text('name'),
    email: text('email'),
    phone: text('phone'),
    marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
    voucherId: uuid('voucher_id'),
    paymentId: uuid('payment_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }),
    accessUntil: timestamp('access_until', { withTimezone: true }),
  },
  (t) => [index('guest_sessions_tenant_idx').on(t.tenantId, t.createdAt), index('guest_sessions_authorized_idx').on(t.tenantId, t.authorizedAt)],
);

export type Console = typeof consoles.$inferSelect;
export type ConsoleSite = typeof consoleSites.$inferSelect;
export type Hostname = typeof hostnames.$inferSelect;
export type PortalSettings = typeof portalSettings.$inferSelect;
export type GuestSession = typeof guestSessions.$inferSelect;

// ── Step 3: editor media, vouchers, payments, notifications, mail templates ──

/** Images for portals and e-mails, stored in the database so backups include them. */
export const media = pgTable('media', {
  id: uuid('id').primaryKey().defaultRandom(),
  // null = platform (e.g. images in platform e-mail templates)
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  data: bytea('data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const vouchers = pgTable(
  'vouchers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Upper case without separators; shown as XXXX-XXXX
    code: text('code').notNull(),
    batch: text('batch'),
    note: text('note'),
    durationMinutes: integer('duration_minutes').notNull(),
    // Number of devices that may use the voucher
    maxUses: integer('max_uses').notNull().default(1),
    uses: integer('uses').notNull().default(0),
    dataLimitMb: integer('data_limit_mb'),
    downKbps: integer('down_kbps'),
    upKbps: integer('up_kbps'),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    firstUsedAt: timestamp('first_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('vouchers_code_unique').on(t.tenantId, t.code), index('vouchers_batch_idx').on(t.tenantId, t.batch)],
);

export const paymentProvider = pgEnum('payment_provider', ['mollie', 'stripe']);
export const paymentStatus = pgEnum('payment_status', ['open', 'paid', 'failed', 'canceled', 'expired']);

export const paymentPackages = pgTable('payment_packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: jsonb('name').$type<Record<string, string>>().notNull().default({}),
  priceCents: integer('price_cents').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  dataLimitMb: integer('data_limit_mb'),
  downKbps: integer('down_kbps'),
  upKbps: integer('up_kbps'),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    guestSessionId: uuid('guest_session_id').references(() => guestSessions.id, { onDelete: 'set null' }),
    packageId: uuid('package_id').references(() => paymentPackages.id, { onDelete: 'set null' }),
    // Copied from the package, so the history stays correct when a package changes
    packageName: text('package_name').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    provider: paymentProvider('provider').notNull(),
    providerRef: text('provider_ref'),
    checkoutUrl: text('checkout_url'),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    status: paymentStatus('status').notNull().default('open'),
    email: text('email'),
    locale: text('locale'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [index('payments_tenant_idx').on(t.tenantId, t.createdAt), index('payments_ref_idx').on(t.provider, t.providerRef)],
);

/** Settings per customer (payments, notifications), like `settings` for the platform. */
export const tenantSettings = pgTable(
  'tenant_settings',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

/** Every notification sent; the unique key makes sure each one goes out only once. */
export const notificationLog = pgTable(
  'notification_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    // e.g. the hostname id or the report month (2026-09)
    ref: text('ref').notNull(),
    recipients: jsonb('recipients').$type<string[]>().notNull().default([]),
    status: text('status').$type<'sent' | 'failed' | 'skipped'>().notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('notification_once').on(t.tenantId, t.kind, t.ref), index('notification_created_idx').on(t.createdAt)],
);

export const mailTemplates = pgTable(
  'mail_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // null = platform template, otherwise a customer's own version
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    locale: text('locale').notNull(),
    subject: text('subject').notNull(),
    mode: text('mode').$type<'visual' | 'html'>().notNull(),
    design: jsonb('design').$type<MailDesign>(),
    html: text('html').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('mail_templates_lookup').on(t.kind, t.locale)],
);

export type Voucher = typeof vouchers.$inferSelect;
export type PaymentPackage = typeof paymentPackages.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type MailTemplate = typeof mailTemplates.$inferSelect;
