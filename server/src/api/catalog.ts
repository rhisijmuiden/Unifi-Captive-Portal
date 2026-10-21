import { z, type ZodType } from 'zod';
import { connectionInput, sitesInput } from '../routes/consoles.js';
import { packageInput } from '../routes/payments.js';
import { planInput, profileInput, invoiceInput } from '../routes/billing.js';
import { portalInput } from '../routes/portal.js';
import { adminInput, tenantInput } from '../routes/tenants.js';
import { userInput } from '../routes/users.js';
import { voucherInput } from '../routes/vouchers.js';
import { targetSchema } from '../services/backups.js';
import { mailContentSchema } from '../services/mailTemplates.js';
import { portalDesignSchema } from '../services/portalDesign.js';
import { notificationSettingsSchema, paymentSettingsSchema, socialSettingsSchema } from '../services/tenantSettings.js';

/**
 * The public REST API (/api/v1/…). Every operation is one of the routes the admin interface
 * uses, opened up for API keys with a scope. Anything not listed here is not reachable with a key.
 */

export type Audience = 'tenant' | 'platform';
type Text = { en: string; nl: string };

/** Resources a key can be given access to; write includes read. */
export const scopes: Record<Audience, Record<string, Text>> = {
  tenant: {
    consoles: { en: 'UniFi consoles and sites', nl: 'UniFi-consoles en sites' },
    hostnames: { en: 'Hostnames and SSL', nl: 'Hostnames en SSL' },
    portal: { en: 'Portal settings, design and images', nl: 'Portalinstellingen, ontwerp en afbeeldingen' },
    guests: { en: 'Guests', nl: 'Gasten' },
    vouchers: { en: 'Vouchers', nl: 'Vouchers' },
    payments: { en: 'Payments and packages', nl: 'Betalingen en pakketten' },
    notifications: { en: 'Notifications and guest e-mails', nl: 'Meldingen en gastmails' },
    reports: { en: 'Overview and reports', nl: 'Overzicht en rapporten' },
    users: { en: 'Team members', nl: 'Teamleden' },
    invoices: { en: 'Your invoices', nl: 'Je facturen' },
  },
  platform: {
    tenants: { en: 'Customers', nl: 'Klanten' },
    users: { en: 'Users', nl: 'Gebruikers' },
    settings: { en: 'Server settings and e-mail templates', nl: 'Serverinstellingen en e-mailtemplates' },
    billing: { en: 'Billing: plans, subscriptions and invoices', nl: 'Facturatie: plannen, abonnementen en facturen' },
    backups: { en: 'Backups (restoring stays in the web interface)', nl: 'Back-ups (terugzetten blijft in de webinterface)' },
    system: { en: 'Version, updates and overview', nl: 'Versie, updates en overzicht' },
  },
};

export const scopeList = (audience: Audience) => Object.keys(scopes[audience]).flatMap((s) => [`${s}:read`, `${s}:write`]);

type Param = { name: string; in: 'path' | 'query'; type?: 'string' | 'integer' | 'boolean'; required?: boolean; text: Text; enum?: string[] };

export type Operation = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** The internal route, as registered with Fastify */
  route: string;
  /** Resource scope per audience; an operation without an audience is not open to that kind of key */
  tenant?: string;
  platform?: string;
  /** Read operations need :read, everything else :write (default: GET reads) */
  access?: 'read' | 'write';
  summary: Text;
  description?: Text;
  body?: ZodType;
  params?: Param[];
  /** Binary response (e.g. a PDF) instead of JSON */
  produces?: string;
};

const id: Param = { name: 'id', in: 'path', required: true, text: { en: 'Id (UUID)', nl: 'Id (UUID)' } };
const kind: Param = { name: 'kind', in: 'path', required: true, text: { en: 'Template kind, e.g. invite or guestWelcome', nl: 'Soort template, bv. invite of guestWelcome' } };
const locale: Param = { name: 'locale', in: 'query', required: true, enum: ['en', 'nl'], text: { en: 'Language of the template', nl: 'Taal van de template' } };
const month: Param = { name: 'month', in: 'query', text: { en: 'Month as YYYY-MM (default: last month)', nl: 'Maand als JJJJ-MM (standaard: vorige maand)' } };

const consoleCreate = z.object({ name: z.string(), apiKey: z.string(), sites: sitesInput }).and(connectionInput);
const consoleUpdate = z.object({ name: z.string().optional(), apiKey: z.string().optional(), verifyTls: z.boolean().optional(), sites: sitesInput.optional() });
const settingsBody = z.record(z.string(), z.unknown());

export const operations: Operation[] = [
  // ── Customer API ────────────────────────────────────────────────────────────
  { method: 'GET', route: '/api/dashboard', tenant: 'reports', platform: 'system', summary: { en: 'Overview figures and recent activity', nl: 'Overzichtscijfers en recente activiteit' } },
  { method: 'GET', route: '/api/reports/monthly', tenant: 'reports', params: [month], summary: { en: 'Monthly report: guests, registrations, payments and peak times', nl: 'Maandrapport: gasten, registraties, betalingen en piekmomenten' } },

  { method: 'GET', route: '/api/consoles', tenant: 'consoles', summary: { en: 'List consoles with their sites', nl: 'Consoles met hun sites' } },
  { method: 'POST', route: '/api/consoles/discover', tenant: 'consoles', body: z.object({ apiKey: z.string() }), summary: { en: 'List the consoles on a UniFi Site Manager account', nl: 'Consoles op een UniFi Site Manager-account opvragen' } },
  { method: 'POST', route: '/api/consoles/test', tenant: 'consoles', body: z.object({ consoleId: z.string().optional(), apiKey: z.string().optional() }).and(connectionInput), summary: { en: 'Test a connection and list its sites', nl: 'Verbinding testen en de sites opvragen' } },
  { method: 'POST', route: '/api/consoles', tenant: 'consoles', body: consoleCreate, summary: { en: 'Connect a console', nl: 'Console koppelen' } },
  { method: 'PUT', route: '/api/consoles/:id', tenant: 'consoles', params: [id], body: consoleUpdate, summary: { en: 'Change a console', nl: 'Console wijzigen' } },
  { method: 'POST', route: '/api/consoles/:id/sync', tenant: 'consoles', params: [id], summary: { en: 'Synchronise access points now', nl: 'Access points nu synchroniseren' } },
  { method: 'DELETE', route: '/api/consoles/:id', tenant: 'consoles', params: [id], summary: { en: 'Disconnect a console', nl: 'Console ontkoppelen' } },

  { method: 'GET', route: '/api/hostnames', tenant: 'hostnames', summary: { en: 'List hostnames with DNS and SSL status', nl: 'Hostnames met DNS- en SSL-status' } },
  { method: 'POST', route: '/api/hostnames', tenant: 'hostnames', body: z.object({ hostname: z.string() }), summary: { en: 'Add a hostname (certificate follows automatically)', nl: 'Hostname toevoegen (certificaat volgt automatisch)' } },
  { method: 'POST', route: '/api/hostnames/:id/check', tenant: 'hostnames', params: [id], summary: { en: 'Check DNS and certificate now', nl: 'DNS en certificaat nu controleren' } },
  { method: 'DELETE', route: '/api/hostnames/:id', tenant: 'hostnames', params: [id], summary: { en: 'Remove a hostname', nl: 'Hostname verwijderen' } },

  { method: 'GET', route: '/api/portal-settings', tenant: 'portal', summary: { en: 'Access & sign-in settings', nl: 'Instellingen toegang & inloggen' } },
  { method: 'PUT', route: '/api/portal-settings', tenant: 'portal', body: portalInput, summary: { en: 'Change access & sign-in settings', nl: 'Toegang & inloggen wijzigen' } },
  { method: 'GET', route: '/api/portal-design', tenant: 'portal', summary: { en: 'Portal design (editor blocks and theme)', nl: 'Portalontwerp (editorblokken en thema)' } },
  { method: 'PUT', route: '/api/portal-design', tenant: 'portal', body: z.object({ design: portalDesignSchema }), summary: { en: 'Save the portal design', nl: 'Portalontwerp opslaan' } },
  { method: 'POST', route: '/api/media', tenant: 'portal', platform: 'settings', body: z.object({ dataUrl: z.string() }), summary: { en: 'Upload an image (data URL, max. 2 MB)', nl: 'Afbeelding uploaden (data-URL, max. 2 MB)' } },
  { method: 'GET', route: '/api/social-settings', tenant: 'portal', summary: { en: 'Facebook login settings', nl: 'Instellingen Facebook-login' } },
  { method: 'PUT', route: '/api/social-settings', tenant: 'portal', body: socialSettingsSchema.partial(), summary: { en: 'Change Facebook login settings', nl: 'Facebook-login wijzigen' } },

  { method: 'GET', route: '/api/guests', tenant: 'guests', params: [{ name: 'limit', in: 'query', type: 'integer', text: { en: 'Maximum number (default 100, max. 500)', nl: 'Maximum aantal (standaard 100, max. 500)' } }], summary: { en: 'Latest guest sessions with statistics', nl: 'Laatste gastsessies met statistieken' } },
  { method: 'DELETE', route: '/api/guests/:id', tenant: 'guests', params: [id], summary: { en: "Delete a guest's personal data (GDPR)", nl: 'Persoonsgegevens van een gast verwijderen (AVG)' } },

  { method: 'GET', route: '/api/vouchers', tenant: 'vouchers', summary: { en: 'List vouchers and batches', nl: 'Vouchers en batches' } },
  { method: 'POST', route: '/api/vouchers', tenant: 'vouchers', body: voucherInput, summary: { en: 'Create vouchers', nl: 'Vouchers aanmaken' } },
  { method: 'POST', route: '/api/vouchers/:id/revoke', tenant: 'vouchers', params: [id], summary: { en: 'Revoke a voucher', nl: 'Voucher intrekken' } },
  { method: 'DELETE', route: '/api/vouchers/:id', tenant: 'vouchers', params: [id], summary: { en: 'Delete a voucher', nl: 'Voucher verwijderen' } },
  { method: 'DELETE', route: '/api/vouchers', tenant: 'vouchers', params: [{ name: 'batch', in: 'query', required: true, text: { en: 'Batch name', nl: 'Batchnaam' } }], summary: { en: 'Delete the unused vouchers of a batch', nl: 'Ongebruikte vouchers van een batch verwijderen' } },

  { method: 'GET', route: '/api/payment-settings', tenant: 'payments', summary: { en: 'Payment provider settings (keys are never returned)', nl: 'Instellingen betaalprovider (sleutels komen nooit terug)' } },
  { method: 'PUT', route: '/api/payment-settings', tenant: 'payments', body: paymentSettingsSchema.partial(), summary: { en: 'Change payment provider settings', nl: 'Betaalprovider wijzigen' } },
  { method: 'POST', route: '/api/payment-settings/test', tenant: 'payments', body: paymentSettingsSchema.partial(), summary: { en: 'Test the payment provider key', nl: 'Sleutel van de betaalprovider testen' } },
  { method: 'GET', route: '/api/payment-packages', tenant: 'payments', summary: { en: 'List paid packages', nl: 'Betaalde pakketten' } },
  { method: 'POST', route: '/api/payment-packages', tenant: 'payments', body: packageInput, summary: { en: 'Add a package', nl: 'Pakket toevoegen' } },
  { method: 'PUT', route: '/api/payment-packages/:id', tenant: 'payments', params: [id], body: packageInput, summary: { en: 'Change a package', nl: 'Pakket wijzigen' } },
  { method: 'DELETE', route: '/api/payment-packages/:id', tenant: 'payments', params: [id], summary: { en: 'Delete a package', nl: 'Pakket verwijderen' } },
  { method: 'GET', route: '/api/payments', tenant: 'payments', summary: { en: 'Payments by guests', nl: 'Betalingen van gasten' } },

  { method: 'GET', route: '/api/notification-settings', tenant: 'notifications', summary: { en: 'Notification settings and the log of sent notifications', nl: 'Meldingsinstellingen en het logboek van verstuurde meldingen' } },
  { method: 'PUT', route: '/api/notification-settings', tenant: 'notifications', body: notificationSettingsSchema.partial(), summary: { en: 'Change notification settings', nl: 'Meldingen wijzigen' } },
  { method: 'GET', route: '/api/mail-templates', tenant: 'notifications', platform: 'settings', summary: { en: 'List e-mail templates', nl: 'E-mailtemplates' } },
  { method: 'GET', route: '/api/mail-templates/:kind', tenant: 'notifications', platform: 'settings', params: [kind, locale], summary: { en: 'Get an e-mail template', nl: 'E-mailtemplate ophalen' } },
  { method: 'PUT', route: '/api/mail-templates/:kind', tenant: 'notifications', platform: 'settings', params: [kind], body: z.object({ locale: z.enum(['en', 'nl']) }).and(mailContentSchema), summary: { en: 'Save an e-mail template', nl: 'E-mailtemplate opslaan' } },
  { method: 'DELETE', route: '/api/mail-templates/:kind', tenant: 'notifications', platform: 'settings', params: [kind, locale], summary: { en: 'Reset an e-mail template to the default', nl: 'E-mailtemplate terugzetten naar standaard' } },

  { method: 'GET', route: '/api/users', tenant: 'users', platform: 'users', params: [{ name: 'tenantId', in: 'query', text: { en: 'Platform keys: only users of this customer', nl: 'Platformsleutels: alleen gebruikers van deze klant' } }], summary: { en: 'List users', nl: 'Gebruikers' } },
  { method: 'POST', route: '/api/users', tenant: 'users', platform: 'users', body: userInput, summary: { en: 'Add a user (and invite by e-mail)', nl: 'Gebruiker toevoegen (en uitnodigen per e-mail)' } },
  { method: 'PUT', route: '/api/users/:id', tenant: 'users', platform: 'users', params: [id], body: userInput.omit({ sendInvite: true }).partial(), summary: { en: 'Change a user', nl: 'Gebruiker wijzigen' } },
  { method: 'POST', route: '/api/users/:id/invite', tenant: 'users', platform: 'users', params: [id], summary: { en: 'Send the invitation again', nl: 'Uitnodiging opnieuw sturen' } },
  { method: 'DELETE', route: '/api/users/:id', tenant: 'users', platform: 'users', params: [id], summary: { en: 'Delete a user', nl: 'Gebruiker verwijderen' } },

  { method: 'GET', route: '/api/invoices', tenant: 'invoices', summary: { en: 'Your invoices and subscription', nl: 'Je facturen en abonnement' } },
  { method: 'GET', route: '/api/billing/invoices/:id/pdf', tenant: 'invoices', platform: 'billing', params: [id], produces: 'application/pdf', summary: { en: 'Download an invoice as PDF', nl: 'Factuur als pdf downloaden' } },

  // ── Platform API ────────────────────────────────────────────────────────────
  { method: 'GET', route: '/api/tenants', platform: 'tenants', summary: { en: 'List customers', nl: 'Klanten' } },
  { method: 'GET', route: '/api/tenants/:id', platform: 'tenants', params: [id], summary: { en: 'Get a customer', nl: 'Klant ophalen' } },
  {
    method: 'POST',
    route: '/api/tenants',
    platform: 'tenants',
    body: tenantInput.extend({ admin: adminInput }),
    summary: { en: 'Create a customer, optionally with a first admin', nl: 'Klant aanmaken, eventueel met een eerste beheerder' },
    description: { en: 'With `admin`, that person is invited by e-mail right away.', nl: 'Met `admin` krijgt die persoon meteen een uitnodiging per e-mail.' },
  },
  { method: 'PUT', route: '/api/tenants/:id', platform: 'tenants', params: [id], body: tenantInput.partial(), summary: { en: 'Change or suspend a customer', nl: 'Klant wijzigen of opschorten' } },
  { method: 'DELETE', route: '/api/tenants/:id', platform: 'tenants', params: [id], summary: { en: 'Delete a customer with all its data', nl: 'Klant met al zijn gegevens verwijderen' } },

  {
    method: 'GET',
    route: '/api/settings/:key',
    platform: 'settings',
    params: [{ name: 'key', in: 'path', required: true, enum: ['smtp', 'sso', 'system', 'hosting', 'billing'], text: { en: 'Settings group', nl: 'Instellingengroep' } }],
    summary: { en: 'Get server settings (secrets are never returned)', nl: 'Serverinstellingen ophalen (geheimen komen nooit terug)' },
  },
  {
    method: 'PUT',
    route: '/api/settings/:key',
    platform: 'settings',
    params: [{ name: 'key', in: 'path', required: true, enum: ['smtp', 'sso', 'system', 'hosting', 'billing'], text: { en: 'Settings group', nl: 'Instellingengroep' } }],
    body: settingsBody,
    summary: { en: 'Change server settings', nl: 'Serverinstellingen wijzigen' },
    description: { en: 'Fields that are left out keep their value; an empty secret keeps the stored one.', nl: 'Weggelaten velden houden hun waarde; een leeg geheim houdt het opgeslagen geheim.' },
  },
  { method: 'POST', route: '/api/settings/smtp/test', platform: 'settings', body: z.object({ to: z.string() }), summary: { en: 'Send a test e-mail', nl: 'Testmail versturen' } },
  { method: 'POST', route: '/api/settings/hosting/detect-ip', platform: 'settings', summary: { en: "Detect the server's public IP addresses", nl: 'Publieke IP-adressen van de server bepalen' } },
  { method: 'POST', route: '/api/settings/hosting/check', platform: 'settings', summary: { en: 'Check the admin hostname (DNS and SSL)', nl: 'Beheerhostname controleren (DNS en SSL)' } },

  { method: 'GET', route: '/api/billing/plans', platform: 'billing', summary: { en: 'List price plans', nl: 'Prijsplannen' } },
  { method: 'POST', route: '/api/billing/plans', platform: 'billing', body: planInput, summary: { en: 'Add a price plan', nl: 'Prijsplan toevoegen' } },
  { method: 'PUT', route: '/api/billing/plans/:id', platform: 'billing', params: [id], body: planInput, summary: { en: 'Change a price plan', nl: 'Prijsplan wijzigen' } },
  { method: 'DELETE', route: '/api/billing/plans/:id', platform: 'billing', params: [id], summary: { en: 'Delete a price plan', nl: 'Prijsplan verwijderen' } },
  { method: 'GET', route: '/api/billing/customers', platform: 'billing', summary: { en: 'Billing profile and subscription of every customer', nl: 'Factuurgegevens en abonnement van elke klant' } },
  { method: 'PUT', route: '/api/billing/customers/:tenantId', platform: 'billing', params: [{ ...id, name: 'tenantId' }], body: profileInput, summary: { en: "Change a customer's billing profile and subscription", nl: 'Factuurgegevens en abonnement van een klant wijzigen' } },
  { method: 'POST', route: '/api/billing/customers/:tenantId/resume', platform: 'billing', params: [{ ...id, name: 'tenantId' }], summary: { en: 'Lift the portal pause for unpaid invoices', nl: 'Portalpauze voor onbetaalde facturen opheffen' } },
  { method: 'GET', route: '/api/billing/invoices', platform: 'billing', summary: { en: 'List invoices', nl: 'Facturen' } },
  { method: 'POST', route: '/api/billing/invoices', platform: 'billing', body: invoiceInput.extend({ tenantId: z.string() }), summary: { en: 'Create a draft invoice', nl: 'Conceptfactuur maken' } },
  { method: 'PUT', route: '/api/billing/invoices/:id', platform: 'billing', params: [id], body: invoiceInput, summary: { en: 'Change a draft invoice', nl: 'Conceptfactuur wijzigen' } },
  { method: 'DELETE', route: '/api/billing/invoices/:id', platform: 'billing', params: [id], summary: { en: 'Delete a draft invoice', nl: 'Conceptfactuur verwijderen' } },
  { method: 'POST', route: '/api/billing/invoices/:id/issue', platform: 'billing', params: [id], body: z.object({ send: z.boolean().optional() }), summary: { en: 'Issue an invoice (number assigned), optionally e-mail it', nl: 'Factuur definitief maken (nummer toegekend), eventueel mailen' } },
  { method: 'POST', route: '/api/billing/invoices/:id/send', platform: 'billing', params: [id], body: z.object({ reminder: z.boolean().optional() }), summary: { en: 'E-mail an invoice (again)', nl: 'Factuur (opnieuw) mailen' } },
  { method: 'POST', route: '/api/billing/invoices/:id/mark-paid', platform: 'billing', params: [id], body: z.object({ notify: z.boolean().optional() }), summary: { en: 'Mark an invoice paid', nl: 'Factuur als betaald markeren' } },
  { method: 'POST', route: '/api/billing/invoices/:id/void', platform: 'billing', params: [id], summary: { en: 'Void an invoice', nl: 'Factuur vervallen verklaren' } },

  { method: 'GET', route: '/api/backups', platform: 'backups', summary: { en: 'Backup locations, settings and recent runs', nl: 'Back-uplocaties, instellingen en recente runs' } },
  { method: 'GET', route: '/api/backups/status', platform: 'backups', summary: { en: 'Running backup and restore status', nl: 'Lopende back-up en status van terugzetten' } },
  { method: 'PUT', route: '/api/backups/settings', platform: 'backups', body: z.object({ passphrase: z.string().nullable().optional(), notifyOnFailure: z.boolean().optional() }), summary: { en: 'Change the backup passphrase and alerts', nl: 'Back-upwachtwoordzin en meldingen wijzigen' } },
  { method: 'POST', route: '/api/backups/ssh-key', platform: 'backups', body: z.object({ regenerate: z.boolean().optional() }), summary: { en: "The server's public SSH key for SCP locations", nl: 'Publieke SSH-sleutel van de server voor SCP-locaties' } },
  { method: 'POST', route: '/api/backups/targets/test', platform: 'backups', body: z.object({ id: z.string().optional() }).and(targetSchema), summary: { en: 'Test a backup location', nl: 'Back-uplocatie testen' } },
  { method: 'POST', route: '/api/backups/targets', platform: 'backups', body: targetSchema, summary: { en: 'Add a backup location', nl: 'Back-uplocatie toevoegen' } },
  { method: 'PUT', route: '/api/backups/targets/:id', platform: 'backups', params: [id], body: targetSchema, summary: { en: 'Change a backup location', nl: 'Back-uplocatie wijzigen' } },
  { method: 'DELETE', route: '/api/backups/targets/:id', platform: 'backups', params: [id], summary: { en: 'Remove a backup location (the backups stay)', nl: 'Back-uplocatie verwijderen (de back-ups blijven)' } },
  { method: 'POST', route: '/api/backups/targets/:id/run', platform: 'backups', params: [id], body: z.object({ type: z.enum(['full', 'incremental']) }), summary: { en: 'Start a backup now', nl: 'Nu een back-up maken' } },
  { method: 'GET', route: '/api/backups/targets/:id/sets', platform: 'backups', params: [id], summary: { en: 'Backups stored on a location', nl: 'Back-ups op een locatie' } },

  { method: 'GET', route: '/api/system/info', platform: 'system', summary: { en: 'Version, channel and host details', nl: 'Versie, kanaal en servergegevens' } },
  { method: 'GET', route: '/api/system/updates', platform: 'system', params: [{ name: 'force', in: 'query', text: { en: '1 = skip the cache', nl: '1 = cache overslaan' } }], summary: { en: 'Check for updates', nl: 'Controleren op updates' } },
  { method: 'GET', route: '/api/system/update/status', platform: 'system', summary: { en: 'Status of a running update', nl: 'Status van een lopende update' } },
  { method: 'POST', route: '/api/system/update', platform: 'system', body: z.object({ version: z.string(), system: z.boolean().optional() }), summary: { en: 'Install a version (and optionally system packages)', nl: 'Versie installeren (en eventueel systeempakketten)' } },
];

const index = new Map(operations.map((op) => [`${op.method} ${op.route}`, op]));

/** The operation for a matched route, or undefined when the route is not part of the public API. */
export const findOperation = (method: string, route: string | undefined) => (route ? index.get(`${method} ${route}`) : undefined);

export const accessOf = (op: Operation) => op.access ?? (op.method === 'GET' ? 'read' : 'write');

/** The scope a key needs for an operation, or null when its kind of key may not use it. */
export function requiredScope(op: Operation, audience: Audience): string | null {
  const resource = op[audience];
  return resource ? `${resource}:${accessOf(op)}` : null;
}

/** Write includes read. */
export function hasScope(granted: string[], needed: string) {
  if (granted.includes(needed)) return true;
  const [resource, access] = needed.split(':');
  return access === 'read' && granted.includes(`${resource}:write`);
}

/** /api/consoles/:id → /api/v1/consoles/{id} */
export const publicPath = (route: string) => route.replace(/^\/api\//, '/api/v1/').replace(/:(\w+)/g, '{$1}');
