import { bigint, boolean, customType, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { Manifest, Schedule } from '../services/backup/format.js';
import type { MailDesign } from '../shared/mailDesign.js';
import type { FieldMode, LoginMethod, PortalDesign } from '../shared/portalDesign.js';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const userRole = pgEnum('user_role', ['superadmin', 'tenant_admin', 'tenant_user', 'reseller_admin']);
export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended']);
export const tokenPurpose = pgEnum('token_purpose', ['invite', 'password_reset']);

// White-label partners who manage their own customers under their own brand
export const resellers = pgTable('resellers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  contactEmail: text('contact_email'),
  status: tenantStatus('status').notNull().default('active'),
  // null = no limit
  maxTenants: integer('max_tenants'),
  // Brand shown in the admin panel of the reseller and its customers
  brandName: text('brand_name').notNull(),
  logoUrl: text('logo_url'),
  logoDarkUrl: text('logo_dark_url'),
  accentColor: text('accent_color'),
  websiteUrl: text('website_url'),
  supportEmail: text('support_email'),
  // The reseller's own address for the admin panel, served by Caddy with automatic SSL
  adminHostname: text('admin_hostname').unique(),
  // Set by the platform admin per reseller: which RHIS mentions stay visible
  showPoweredBy: boolean('show_powered_by').notNull().default(true),
  showDesignedBy: boolean('show_designed_by').notNull().default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Customers of a reseller; null = a direct customer of the platform
    resellerId: uuid('reseller_id').references(() => resellers.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    contactEmail: text('contact_email'),
    status: tenantStatus('status').notNull().default('active'),
    notes: text('notes'),
    // Set while the guest portal is paused for unpaid invoices; the customer can still sign in and pay
    billingSuspendedAt: timestamp('billing_suspended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tenants_reseller_idx').on(t.resellerId)],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    role: userRole('role').notNull(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    // Reseller admins belong to a reseller instead of a customer
    resellerId: uuid('reseller_id').references(() => resellers.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active').notNull().default(true),
    // Set when an admin generated the password: the user chooses their own at the first sign-in
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    entraOid: text('entra_oid').unique(),
    // Preferred language for the interface and e-mails (null = follow the browser)
    locale: text('locale'),
    // Two-factor sign-in with an authenticator app (TOTP); secrets are encrypted with APP_SECRET
    totpSecret: text('totp_secret'),
    // Secret shown during set-up, until the user confirms it with a first code
    totpPendingSecret: text('totp_pending_secret'),
    totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
    // Last time step a code was used for, so a code cannot be used twice
    totpLastStep: integer('totp_last_step'),
    // sha256 of the unused one-time recovery codes
    recoveryCodes: jsonb('recovery_codes').$type<string[]>().notNull().default([]),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('users_tenant_idx').on(t.tenantId), index('users_reseller_idx').on(t.resellerId)],
);

export const sessions = pgTable('sessions', {
  // sha256 of the cookie token; the raw token is never stored
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  // How the user signed in; Microsoft sign-ins rely on Entra's own multi-factor authentication
  method: text('method').$type<'password' | 'entra'>().notNull().default('password'),
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
    // Set when the action came in through the API with this key (no foreign key: the trail outlives the key)
    apiKeyId: uuid('api_key_id'),
    action: text('action').notNull(),
    details: jsonb('details'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_created_idx').on(t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Tenant = typeof tenants.$inferSelect;
export type Reseller = typeof resellers.$inferSelect;

// ── UniFi consoles and guest portal ──────────────────────────────────────────

export const consoleConnection = pgEnum('console_connection', ['site_manager', 'direct']);
export const healthStatus = pgEnum('health_status', ['unknown', 'ok', 'error']);
export const hostnameStatus = pgEnum('hostname_status', ['pending', 'dns_ok', 'active', 'error']);
export const guestStatus = pgEnum('guest_status', ['pending', 'authorized', 'failed']);

export type FabricHost = { id: string; name: string; model: string | null; version: string | null };

/**
 * A UniFi Fabric (or Site Manager organisation): one API key that reaches many consoles.
 * Its consoles get a copy of the key, so replacing it here replaces it for all of them.
 */
export const unifiFabrics = pgTable('unifi_fabrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  apiKey: text('api_key').notNull(),
  status: healthStatus('status').notNull().default('unknown'),
  lastError: text('last_error'),
  lastCheckAt: timestamp('last_check_at', { withTimezone: true }),
  // The consoles the key reached at the last check
  hosts: jsonb('hosts').$type<FabricHost[]>().notNull().default([]),
  // Every console id ever seen, so only consoles that join the Fabric later are reported as new
  knownHostIds: jsonb('known_host_ids').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const consoles = pgTable('consoles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  connection: consoleConnection('connection').notNull(),
  // Site Manager host id (connection = site_manager)
  hostId: text('host_id'),
  // Set when the console was linked through a Fabric; the key then comes from the Fabric
  fabricId: uuid('fabric_id').references(() => unifiFabrics.id, { onDelete: 'cascade' }),
  // https://<console-address> (connection = direct)
  baseUrl: text('base_url'),
  apiKey: text('api_key').notNull(),
  verifyTls: boolean('verify_tls').notNull().default(true),
  status: healthStatus('status').notNull().default('unknown'),
  lastError: text('last_error'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  // First failed check of the current outage; cleared when the console answers again
  offlineSince: timestamp('offline_since', { withTimezone: true }),
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
  // State reported by UniFi (ONLINE, OFFLINE, UPDATING, …)
  state: text('state'),
  offlineSince: timestamp('offline_since', { withTimezone: true }),
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
    // Hotel login: the stay (room + surname) the guest signed in with
    hotelStayId: uuid('hotel_stay_id'),
    // When the guest saw the advert before signing in (shown once per guest page)
    adSeenAt: timestamp('ad_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }),
    accessUntil: timestamp('access_until', { withTimezone: true }),
  },
  (t) => [
    index('guest_sessions_tenant_idx').on(t.tenantId, t.createdAt),
    index('guest_sessions_authorized_idx').on(t.tenantId, t.authorizedAt),
    // Platform statistics look across all customers by sign-in time
    index('guest_sessions_authorized_at_idx').on(t.authorizedAt),
    index('guest_sessions_hotel_idx').on(t.hotelStayId),
  ],
);

export type Console = typeof consoles.$inferSelect;
export type UnifiFabric = typeof unifiFabrics.$inferSelect;
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

// ── Step 4: billing customers for their portal ──────────────────────────────

export const billingInterval = pgEnum('billing_interval', ['month', 'quarter', 'year']);
export const invoiceStatus = pgEnum('invoice_status', ['draft', 'open', 'paid', 'void']);

/** Who an invoice is from or to, copied onto the invoice when it is issued. */
export type BillingParty = {
  name: string;
  address: string;
  email: string;
  vatNumber: string;
  cocNumber?: string;
  phone?: string;
  website?: string;
  iban?: string;
  bic?: string;
  reference?: string;
};
export type InvoiceLine = { description: string; quantity: number; unitCents: number };

/** Reusable price plans the platform admin offers, e.g. "Basic" for 19.95 a month. */
export const billingPlans = pgTable('billing_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  // Excluding VAT
  priceCents: integer('price_cents').notNull(),
  interval: billingInterval('interval').notNull().default('month'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Per customer: invoice details and the subscription for their portal. */
export const tenantBilling = pgTable('tenant_billing', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyName: text('company_name').notNull().default(''),
  address: text('address').notNull().default(''),
  // Invoices go here; empty = the customer's contact address, then its admins
  email: text('email').notNull().default(''),
  vatNumber: text('vat_number').notNull().default(''),
  reference: text('reference').notNull().default(''),
  locale: text('locale').notNull().default('en'),
  // VAT in basis points (2100 = 21%); reverse charge = 0% with the legal note, for EU business customers
  vatRateBp: integer('vat_rate_bp').notNull().default(2100),
  reverseCharge: boolean('reverse_charge').notNull().default(false),
  // Subscription; name and price are copied from the plan but can differ per customer
  subscriptionActive: boolean('subscription_active').notNull().default(false),
  planId: uuid('plan_id').references(() => billingPlans.id, { onDelete: 'set null' }),
  planName: text('plan_name').notNull().default(''),
  priceCents: integer('price_cents').notNull().default(0),
  interval: billingInterval('interval').notNull().default('month'),
  startDate: date('start_date', { mode: 'string' }),
  // The next period to invoice starts on this date (invoices are sent in advance)
  nextInvoiceDate: date('next_invoice_date', { mode: 'string' }),
  // Pause the guest portal automatically when invoices stay unpaid (platform setting decides when)
  autoSuspend: boolean('auto_suspend').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Kept when a customer is deleted: invoices must be kept for the tax authorities
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    // Assigned when the invoice is issued, without gaps
    number: text('number').unique(),
    status: invoiceStatus('status').notNull().default('draft'),
    source: text('source').$type<'subscription' | 'manual'>().notNull().default('manual'),
    locale: text('locale').notNull().default('en'),
    currency: text('currency').notNull().default('EUR'),
    issueDate: date('issue_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    periodStart: date('period_start', { mode: 'string' }),
    periodEnd: date('period_end', { mode: 'string' }),
    seller: jsonb('seller').$type<BillingParty>(),
    customer: jsonb('customer').$type<BillingParty>().notNull(),
    lines: jsonb('lines').$type<InvoiceLine[]>().notNull().default([]),
    vatRateBp: integer('vat_rate_bp').notNull().default(2100),
    reverseCharge: boolean('reverse_charge').notNull().default(false),
    subtotalCents: integer('subtotal_cents').notNull().default(0),
    vatCents: integer('vat_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull().default(0),
    notes: text('notes').notNull().default(''),
    // Secret part of the public pay link in the e-mail
    payToken: text('pay_token').notNull().unique(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    remindersSent: integer('reminders_sent').notNull().default(0),
    lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paidVia: text('paid_via').$type<'online' | 'manual'>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('invoices_tenant_idx').on(t.tenantId, t.createdAt), index('invoices_status_idx').on(t.status, t.dueDate)],
);

/** Every online payment attempt for an invoice, with the platform's own Mollie or Stripe account. */
export const invoicePayments = pgTable(
  'invoice_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    provider: paymentProvider('provider').notNull(),
    providerRef: text('provider_ref'),
    checkoutUrl: text('checkout_url'),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    status: paymentStatus('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [index('invoice_payments_ref_idx').on(t.provider, t.providerRef), index('invoice_payments_invoice_idx').on(t.invoiceId)],
);

/** Last used invoice number per prefix (e.g. "2026-"), so numbers run on without gaps. */
export const invoiceSequences = pgTable('invoice_sequences', {
  prefix: text('prefix').primaryKey(),
  last: integer('last').notNull().default(0),
});

export type BillingPlan = typeof billingPlans.$inferSelect;
export type TenantBilling = typeof tenantBilling.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoicePayment = typeof invoicePayments.$inferSelect;

// ── Step 5: backups ─────────────────────────────────────────────────────────

export const backupTargetType = pgEnum('backup_target_type', ['local', 'ftp', 'ftps', 'scp']);

/** A place backups are sent to, with its own schedule and retention. */
export const backupTargets = pgTable('backup_targets', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: backupTargetType('type').notNull(),
  host: text('host').notNull().default(''),
  port: integer('port').notNull().default(0),
  username: text('username').notNull().default(''),
  // Encrypted with APP_SECRET
  password: text('password').notNull().default(''),
  tlsMode: text('tls_mode').$type<'explicit' | 'implicit'>().notNull().default('explicit'),
  verifyCertificate: boolean('verify_certificate').notNull().default(true),
  authMethod: text('auth_method').$type<'key' | 'password'>().notNull().default('key'),
  // SSH host key fingerprint, remembered on the first successful connection
  hostKey: text('host_key').notNull().default(''),
  path: text('path').notNull(),
  schedule: jsonb('schedule').$type<Schedule>().notNull(),
  keepFull: integer('keep_full').notNull().default(4),
  // The last set on this location, the base for the next incremental backup (without the app secret)
  lastManifest: jsonb('last_manifest').$type<Omit<Manifest, 'appSecret'>>(),
  lastFullAt: timestamp('last_full_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const backupRuns = pgTable(
  'backup_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetId: uuid('target_id').references(() => backupTargets.id, { onDelete: 'set null' }),
    targetName: text('target_name').notNull(),
    setId: text('set_id'),
    type: text('type').$type<'full' | 'incremental'>().notNull(),
    trigger: text('trigger').$type<'schedule' | 'manual'>().notNull(),
    status: text('status').$type<'success' | 'failed'>().notNull(),
    entries: integer('entries'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    storedBytes: bigint('stored_bytes', { mode: 'number' }),
    removedSets: integer('removed_sets'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('backup_runs_started_idx').on(t.startedAt)],
);

export type BackupTarget = typeof backupTargets.$inferSelect;
export type BackupRun = typeof backupRuns.$inferSelect;

// ── Step 6: API keys and webhooks ───────────────────────────────────────────

/** A key for the REST API: of one customer (tenantId) or of the platform (tenantId null). */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // First characters of the key, shown in lists so a key can be recognised; the key itself is only stored hashed
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    // e.g. ['consoles:read', 'vouchers:write']; write includes read
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    rateLimit: integer('rate_limit').notNull().default(120),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastUsedIp: text('last_used_ip'),
    requestCount: bigint('request_count', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('api_keys_tenant_idx').on(t.tenantId)],
);

/** Every request made with an API key: the audit trail per key. Kept for 90 days. */
export const apiRequests = pgTable(
  'api_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    path: text('path').notNull(),
    status: integer('status').notNull(),
    durationMs: integer('duration_ms').notNull(),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('api_requests_key_idx').on(t.apiKeyId, t.createdAt), index('api_requests_created_idx').on(t.createdAt)],
);

/** An address that receives events, of one customer or of the platform. */
export const webhooks = pgTable(
  'webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    description: text('description').notNull().default(''),
    events: jsonb('events').$type<string[]>().notNull().default([]),
    // Signing secret, encrypted with APP_SECRET
    secret: text('secret').notNull(),
    active: boolean('active').notNull().default(true),
    // Consecutive failed deliveries; the webhook is switched off after too many
    failures: integer('failures').notNull().default(0),
    disabledReason: text('disabled_reason'),
    lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('webhooks_tenant_idx').on(t.tenantId)],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').$type<'pending' | 'success' | 'failed'>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    error: text('error'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => [index('webhook_deliveries_hook_idx').on(t.webhookId, t.createdAt), index('webhook_deliveries_due_idx').on(t.status, t.nextAttemptAt)],
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;

// ── Step 7, part 2: SMS codes and hotel stays ──

/** A code sent by SMS to a guest; only its hash is kept. */
export const guestVerifications = pgTable(
  'guest_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    guestSessionId: uuid('guest_session_id').references(() => guestSessions.id, { onDelete: 'set null' }),
    // E.164, e.g. +31612345678
    phone: text('phone').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    provider: text('provider').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('guest_verifications_session_idx').on(t.guestSessionId, t.createdAt),
    index('guest_verifications_tenant_idx').on(t.tenantId, t.createdAt),
    index('guest_verifications_phone_idx').on(t.phone, t.createdAt),
  ],
);

export type HotelStaySource = 'manual' | 'csv' | 'api' | 'apaleo' | 'mews';

/** A hotel guest who may sign in with room number and surname until departure. */
export const hotelStays = pgTable(
  'hotel_stays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    room: text('room').notNull(),
    surname: text('surname').notNull(),
    // Lower case without accents, spaces or punctuation, for matching what the guest types
    surnameKey: text('surname_key').notNull(),
    arrival: timestamp('arrival', { withTimezone: true }).notNull(),
    departure: timestamp('departure', { withTimezone: true }).notNull(),
    source: text('source').$type<HotelStaySource>().notNull().default('manual'),
    // Reservation id in the PMS, for updates on the next sync
    externalId: text('external_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('hotel_stays_room_idx').on(t.tenantId, t.room, t.departure),
    uniqueIndex('hotel_stays_external_unique').on(t.tenantId, t.source, t.externalId),
  ],
);

export type GuestVerification = typeof guestVerifications.$inferSelect;
export type HotelStay = typeof hotelStays.$inferSelect;

// ── Step 7, part 3: marketing, privacy requests, survey and adverts ──

/** One person per e-mail address and customer, built from the guest sign-ins; synced to Mailchimp or HubSpot. */
export const guestContacts = pgTable(
  'guest_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name'),
    phone: text('phone'),
    locale: text('locale'),
    // Last sign-in method, e.g. email or google
    source: text('source'),
    optIn: boolean('opt_in').notNull().default(false),
    optInAt: timestamp('opt_in_at', { withTimezone: true }),
    visits: integer('visits').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    syncError: text('sync_error'),
  },
  (t) => [uniqueIndex('guest_contacts_email_unique').on(t.tenantId, t.email), index('guest_contacts_seen_idx').on(t.tenantId, t.lastSeenAt)],
);

/** A guest's request to erase their data, confirmed through a link in an e-mail. */
export const privacyRequests = pgTable(
  'privacy_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Kept until the request is done, then only the hash remains as proof
    email: text('email'),
    emailHash: text('email_hash').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    status: text('status').$type<'pending' | 'done'>().notNull().default('pending'),
    sessions: integer('sessions').notNull().default(0),
    via: text('via').$type<'guest' | 'admin'>().notNull().default('guest'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    doneAt: timestamp('done_at', { withTimezone: true }),
  },
  (t) => [index('privacy_requests_tenant_idx').on(t.tenantId, t.createdAt)],
);

/** Answers to the short survey after signing in. */
export const surveyResponses = pgTable(
  'survey_responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    guestSessionId: uuid('guest_session_id')
      .references(() => guestSessions.id, { onDelete: 'set null' })
      .unique(),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    locale: text('locale'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('survey_responses_tenant_idx').on(t.tenantId, t.createdAt)],
);

/** An image or video on the guest portal: before signing in (splash) or on the "connected" page. */
export const portalAds = pgTable(
  'portal_ads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').$type<'image' | 'video'>().notNull(),
    mediaId: uuid('media_id').references(() => media.id, { onDelete: 'set null' }),
    linkUrl: text('link_url'),
    placement: text('placement').$type<'before' | 'after'>().notNull(),
    // Before signing in: how long the guest watches before "Continue" appears
    seconds: integer('seconds').notNull().default(5),
    active: boolean('active').notNull().default(true),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('portal_ads_tenant_idx').on(t.tenantId)],
);

export const adStats = pgTable(
  'ad_stats',
  {
    adId: uuid('ad_id')
      .notNull()
      .references(() => portalAds.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    views: integer('views').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.adId, t.day] })],
);

export type GuestContact = typeof guestContacts.$inferSelect;
export type PortalAd = typeof portalAds.$inferSelect;
