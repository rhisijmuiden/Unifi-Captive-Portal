import { z, type ZodType } from 'zod';
import { connectionInput, sitesInput } from '../routes/consoles.js';
import { packageInput } from '../routes/payments.js';
import { planInput, profileInput, invoiceInput } from '../routes/billing.js';
import { portalInput } from '../routes/portal.js';
import { adminInput, tenantInput } from '../routes/tenants.js';
import { resellerInput } from '../routes/resellers.js';
import { userInput, userUpdateInput } from '../routes/users.js';
import { stayInput, staysImport } from '../routes/hotel.js';
import { adInput } from '../routes/ads.js';
import { voucherInput } from '../routes/vouchers.js';
import { targetSchema } from '../services/backups.js';
import { mailContentSchema } from '../services/mailTemplates.js';
import { portalDesignSchema } from '../services/portalDesign.js';
import { hotelSettingsSchema, marketingSettingsSchema, notificationSettingsSchema, paymentSettingsSchema, securitySettingsSchema, smsSettingsSchema, socialSettingsSchema, surveySettingsSchema } from '../services/tenantSettings.js';

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
    hotel: { en: 'Hotel stays for the room login', nl: 'Hotelverblijven voor de kamerlogin' },
    marketing: { en: 'Newsletter contacts, privacy requests, survey and ads', nl: 'Nieuwsbriefcontacten, privacyverzoeken, enquête en advertenties' },
    payments: { en: 'Payments and packages', nl: 'Betalingen en pakketten' },
    notifications: { en: 'Notifications and guest e-mails', nl: 'Meldingen en gastmails' },
    reports: { en: 'Overview and reports', nl: 'Overzicht en rapporten' },
    users: { en: 'Team members', nl: 'Teamleden' },
    invoices: { en: 'Your invoices', nl: 'Je facturen' },
  },
  platform: {
    tenants: { en: 'Customers', nl: 'Klanten' },
    resellers: { en: 'White-label resellers', nl: 'White-label resellers' },
    users: { en: 'Users', nl: 'Gebruikers' },
    settings: { en: 'Server settings and e-mail templates', nl: 'Serverinstellingen en e-mailtemplates' },
    billing: { en: 'Billing: plans, subscriptions and invoices', nl: 'Facturatie: plannen, abonnementen en facturen' },
    backups: { en: 'Backups (restoring stays in the web interface)', nl: 'Back-ups (terugzetten blijft in de webinterface)' },
    system: { en: 'Version, updates and overview', nl: 'Versie, updates en overzicht' },
    statistics: { en: 'Platform statistics across all customers', nl: 'Platformstatistieken over alle klanten' },
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

const statsParams: Param[] = [
  { name: 'from', in: 'query', text: { en: 'First day as YYYY-MM-DD (default: 29 days before to)', nl: 'Eerste dag als JJJJ-MM-DD (standaard: 29 dagen voor to)' } },
  { name: 'to', in: 'query', text: { en: 'Last day as YYYY-MM-DD (default: today)', nl: 'Laatste dag als JJJJ-MM-DD (standaard: vandaag)' } },
  { name: 'reseller', in: 'query', text: { en: 'Reseller id, or direct for customers without a reseller', nl: 'Id van een reseller, of direct voor klanten zonder reseller' } },
  { name: 'tenant', in: 'query', text: { en: 'Customer id', nl: 'Id van een klant' } },
  { name: 'granularity', in: 'query', enum: ['day', 'week', 'month'], text: { en: 'Bars per day, week or month (default: by period length)', nl: 'Staven per dag, week of maand (standaard: naar lengte van de periode)' } },
];

const consoleCreate = z.object({ name: z.string(), apiKey: z.string(), sites: sitesInput }).and(connectionInput);
const consoleUpdate = z.object({ name: z.string().optional(), apiKey: z.string().optional(), verifyTls: z.boolean().optional(), sites: sitesInput.optional() });
const settingsBody = z.record(z.string(), z.unknown());

export const operations: Operation[] = [
  // ── Customer API ────────────────────────────────────────────────────────────
  { method: 'GET', route: '/api/dashboard', tenant: 'reports', platform: 'system', summary: { en: 'Overview figures and recent activity', nl: 'Overzichtscijfers en recente activiteit' } },
  { method: 'GET', route: '/api/live', tenant: 'reports', summary: { en: 'Live figures: guests online, today per hour, latest sign-ins, console status', nl: 'Live cijfers: gasten online, vandaag per uur, laatste aanmeldingen, status consoles' } },
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
  { method: 'GET', route: '/api/social-settings', tenant: 'portal', summary: { en: 'Facebook, Google, Apple and Microsoft login settings', nl: 'Instellingen login met Facebook, Google, Apple en Microsoft' } },
  { method: 'PUT', route: '/api/social-settings', tenant: 'portal', body: socialSettingsSchema.partial(), summary: { en: 'Change the social login settings', nl: 'Sociale logins wijzigen' } },
  { method: 'GET', route: '/api/sms-settings', tenant: 'portal', summary: { en: 'SMS login settings and usage', nl: 'Instellingen en verbruik sms-login' } },
  { method: 'PUT', route: '/api/sms-settings', tenant: 'portal', body: smsSettingsSchema.partial(), summary: { en: 'Change the SMS login settings', nl: 'Sms-login wijzigen' } },

  { method: 'GET', route: '/api/hotel-settings', tenant: 'hotel', summary: { en: 'Hotel login settings and PMS sync status', nl: 'Instellingen hotellogin en PMS-synchronisatie' } },
  { method: 'PUT', route: '/api/hotel-settings', tenant: 'hotel', body: hotelSettingsSchema.partial(), summary: { en: 'Change the hotel login settings', nl: 'Hotellogin wijzigen' } },
  { method: 'POST', route: '/api/hotel/sync', tenant: 'hotel', summary: { en: 'Sync stays from the PMS now', nl: 'Verblijven nu ophalen uit het PMS' } },
  {
    method: 'GET',
    route: '/api/hotel/stays',
    tenant: 'hotel',
    params: [{ name: 'scope', in: 'query', type: 'string', text: { en: 'current, upcoming or all (default: all that have not left)', nl: 'current, upcoming of all (standaard: alles wat nog niet vertrokken is)' } }],
    summary: { en: 'Hotel stays with devices online', nl: 'Hotelverblijven met apparaten online' },
  },
  { method: 'POST', route: '/api/hotel/stays', tenant: 'hotel', body: stayInput, summary: { en: 'Add a stay (room, surname, arrival, departure)', nl: 'Verblijf toevoegen (kamer, achternaam, aankomst, vertrek)' } },
  { method: 'PUT', route: '/api/hotel/stays/:id', tenant: 'hotel', params: [id], body: stayInput, summary: { en: 'Change a stay', nl: 'Verblijf wijzigen' } },
  { method: 'DELETE', route: '/api/hotel/stays/:id', tenant: 'hotel', params: [id], summary: { en: 'Delete a stay; devices already online keep access', nl: 'Verblijf verwijderen; apparaten die online zijn houden toegang' } },
  {
    method: 'POST',
    route: '/api/hotel/stays/import',
    tenant: 'hotel',
    body: staysImport,
    summary: { en: 'Import many stays (CSV text or JSON list); stays with an externalId are updated when sent again', nl: 'Veel verblijven importeren (CSV-tekst of JSON-lijst); verblijven met een externalId worden bijgewerkt' },
  },

  { method: 'GET', route: '/api/marketing-settings', tenant: 'marketing', summary: { en: 'Newsletter export settings (Mailchimp or HubSpot)', nl: 'Instellingen nieuwsbriefexport (Mailchimp of HubSpot)' } },
  { method: 'PUT', route: '/api/marketing-settings', tenant: 'marketing', body: marketingSettingsSchema.partial(), summary: { en: 'Change the newsletter export settings', nl: 'Nieuwsbriefexport wijzigen' } },
  { method: 'POST', route: '/api/marketing-settings/test', tenant: 'marketing', body: marketingSettingsSchema.partial(), summary: { en: 'Test the Mailchimp or HubSpot connection', nl: 'Verbinding met Mailchimp of HubSpot testen' } },
  { method: 'POST', route: '/api/marketing/sync', tenant: 'marketing', summary: { en: 'Send new and changed opt-in contacts now', nl: 'Nieuwe en gewijzigde opt-incontacten nu versturen' } },
  {
    method: 'GET',
    route: '/api/marketing/contacts',
    tenant: 'marketing',
    params: [
      { name: 'optIn', in: 'query', type: 'boolean', text: { en: 'Only guests who opted in', nl: 'Alleen gasten met opt-in' } },
      { name: 'format', in: 'query', enum: ['csv'], text: { en: 'csv for a download of all contacts', nl: 'csv voor een download van alle contacten' } },
    ],
    summary: { en: 'Guest contacts (e-mail, opt-in, visits)', nl: 'Gastcontacten (e-mail, opt-in, bezoeken)' },
  },
  { method: 'POST', route: '/api/marketing/forget', tenant: 'marketing', body: z.object({ email: z.string() }), summary: { en: 'Erase all data about an e-mail address (GDPR), also at the newsletter provider', nl: 'Alle gegevens van een e-mailadres wissen (AVG), ook bij de nieuwsbriefprovider' } },
  { method: 'GET', route: '/api/marketing/privacy-requests', tenant: 'marketing', summary: { en: 'Deletion requests from guests', nl: 'Verwijderverzoeken van gasten' } },
  { method: 'GET', route: '/api/survey-settings', tenant: 'marketing', summary: { en: 'Post-login survey settings', nl: 'Instellingen enquête na het inloggen' } },
  { method: 'PUT', route: '/api/survey-settings', tenant: 'marketing', body: surveySettingsSchema.partial(), summary: { en: 'Change the survey settings', nl: 'Enquête wijzigen' } },
  { method: 'GET', route: '/api/survey', tenant: 'marketing', params: [{ name: 'days', in: 'query', type: 'integer', text: { en: 'Period in days (default 90)', nl: 'Periode in dagen (standaard 90)' } }], summary: { en: 'Survey results: average, per star, per week and comments', nl: 'Enquêteresultaten: gemiddelde, per ster, per week en opmerkingen' } },
  { method: 'GET', route: '/api/ads', tenant: 'marketing', summary: { en: 'Ads and splash videos with views and clicks', nl: 'Advertenties en splashvideo\'s met weergaven en klikken' } },
  { method: 'POST', route: '/api/ads', tenant: 'marketing', body: adInput, summary: { en: 'Add an ad', nl: 'Advertentie toevoegen' } },
  { method: 'PUT', route: '/api/ads/:id', tenant: 'marketing', params: [id], body: adInput.partial(), summary: { en: 'Change an ad', nl: 'Advertentie wijzigen' } },
  { method: 'DELETE', route: '/api/ads/:id', tenant: 'marketing', params: [id], summary: { en: 'Delete an ad', nl: 'Advertentie verwijderen' } },
  { method: 'POST', route: '/api/media/video', tenant: 'marketing', summary: { en: 'Upload a video (raw mp4 or webm body, max. 25 MB)', nl: 'Video uploaden (mp4 of webm als ruwe body, max. 25 MB)' } },

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
  { method: 'POST', route: '/api/users', tenant: 'users', platform: 'users', body: userInput, summary: { en: 'Add a user (invite by e-mail or generate login details)', nl: 'Gebruiker toevoegen (uitnodigen per e-mail of inloggegevens genereren)' }, description: { en: 'With `credentials: "generate"` the response holds `credentials` (login URL, username, password) once; only a hash is stored.', nl: 'Met `credentials: "generate"` staan de inloggegevens (inlogadres, gebruikersnaam, wachtwoord) eenmalig in `credentials`; alleen een hash wordt bewaard.' } },
  { method: 'PUT', route: '/api/users/:id', tenant: 'users', platform: 'users', params: [id], body: userUpdateInput, summary: { en: 'Change a user', nl: 'Gebruiker wijzigen' } },
  { method: 'POST', route: '/api/users/:id/password', tenant: 'users', platform: 'users', params: [id], body: z.object({ mustChangePassword: z.boolean().default(true) }), summary: { en: 'Generate new login details (signs the user out)', nl: 'Nieuwe inloggegevens genereren (meldt de gebruiker af)' } },
  { method: 'POST', route: '/api/users/:id/invite', tenant: 'users', platform: 'users', params: [id], summary: { en: 'Send the invitation again', nl: 'Uitnodiging opnieuw sturen' } },
  { method: 'DELETE', route: '/api/users/:id', tenant: 'users', platform: 'users', params: [id], summary: { en: 'Delete a user', nl: 'Gebruiker verwijderen' } },
  { method: 'POST', route: '/api/users/:id/reset-2fa', tenant: 'users', platform: 'users', params: [id], summary: { en: "Reset a user's two-factor authentication (lost phone)", nl: 'Tweestapsverificatie van een gebruiker resetten (telefoon kwijt)' } },
  { method: 'GET', route: '/api/security-settings', tenant: 'users', summary: { en: 'Two-factor policy for your team', nl: 'Beleid voor tweestapsverificatie van je team' } },
  { method: 'PUT', route: '/api/security-settings', tenant: 'users', body: securitySettingsSchema.partial(), summary: { en: 'Change the two-factor policy for your team', nl: 'Beleid voor tweestapsverificatie wijzigen' } },

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
    description: {
      en: 'With `admin`, that person is invited by e-mail right away, or with `admin.credentials: "generate"` gets a generated password that the response returns once in `credentials`.',
      nl: 'Met `admin` krijgt die persoon meteen een uitnodiging per e-mail, of met `admin.credentials: "generate"` een gegenereerd wachtwoord dat het antwoord eenmalig in `credentials` teruggeeft.',
    },
  },
  { method: 'PUT', route: '/api/tenants/:id', platform: 'tenants', params: [id], body: tenantInput.partial(), summary: { en: 'Change or suspend a customer', nl: 'Klant wijzigen of opschorten' } },
  { method: 'DELETE', route: '/api/tenants/:id', platform: 'tenants', params: [id], summary: { en: 'Delete a customer with all its data', nl: 'Klant met al zijn gegevens verwijderen' } },

  { method: 'GET', route: '/api/resellers', platform: 'resellers', summary: { en: 'List resellers with their number of customers', nl: 'Resellers met hun aantal klanten' } },
  {
    method: 'POST',
    route: '/api/resellers',
    platform: 'resellers',
    body: resellerInput.extend({ admin: adminInput }),
    summary: { en: 'Create a reseller, optionally with a first admin (invited or with generated login details)', nl: 'Reseller aanmaken, eventueel met een eerste beheerder (uitnodiging of gegenereerde inloggegevens)' },
  },
  { method: 'PUT', route: '/api/resellers/:id', platform: 'resellers', params: [id], body: resellerInput.partial(), summary: { en: 'Change a reseller: brand, admin hostname, RHIS mentions, limit or status', nl: 'Reseller wijzigen: merk, beheeradres, RHIS-vermeldingen, limiet of status' } },
  { method: 'DELETE', route: '/api/resellers/:id', platform: 'resellers', params: [id], summary: { en: 'Delete a reseller without customers', nl: 'Reseller zonder klanten verwijderen' } },

  {
    method: 'GET',
    route: '/api/settings/:key',
    platform: 'settings',
    params: [{ name: 'key', in: 'path', required: true, enum: ['smtp', 'sso', 'system', 'hosting', 'billing', 'security'], text: { en: 'Settings group', nl: 'Instellingengroep' } }],
    summary: { en: 'Get server settings (secrets are never returned)', nl: 'Serverinstellingen ophalen (geheimen komen nooit terug)' },
  },
  {
    method: 'PUT',
    route: '/api/settings/:key',
    platform: 'settings',
    params: [{ name: 'key', in: 'path', required: true, enum: ['smtp', 'sso', 'system', 'hosting', 'billing', 'security'], text: { en: 'Settings group', nl: 'Instellingengroep' } }],
    body: settingsBody,
    summary: { en: 'Change server settings', nl: 'Serverinstellingen wijzigen' },
    description: { en: 'Fields that are left out keep their value; an empty secret keeps the stored one.', nl: 'Weggelaten velden houden hun waarde; een leeg geheim houdt het opgeslagen geheim.' },
  },
  { method: 'POST', route: '/api/settings/smtp/test', platform: 'settings', body: z.object({ to: z.string() }), summary: { en: 'Send a test e-mail', nl: 'Testmail versturen' } },
  { method: 'POST', route: '/api/settings/hosting/detect-ip', platform: 'settings', summary: { en: "Detect the server's public IP addresses", nl: 'Publieke IP-adressen van de server bepalen' } },
  { method: 'POST', route: '/api/settings/hosting/check', platform: 'settings', summary: { en: 'Check the admin hostname (DNS and SSL)', nl: 'Beheerhostname controleren (DNS en SSL)' } },
  { method: 'GET', route: '/api/settings/hosting/caddy', platform: 'settings', summary: { en: 'Status of the SSL service (Caddy)', nl: 'Status van de SSL-service (Caddy)' } },

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

  {
    method: 'GET',
    route: '/api/platform/stats',
    platform: 'statistics',
    params: statsParams,
    summary: { en: 'Statistics across customers: totals, trend, weekday × hour heatmap, per reseller and per customer', nl: 'Statistieken over klanten: totalen, verloop, heatmap weekdag × uur, per reseller en per klant' },
  },
  {
    method: 'GET',
    route: '/api/platform/stats/export',
    platform: 'statistics',
    params: [...statsParams, { name: 'format', in: 'query', enum: ['csv', 'pdf'], text: { en: 'csv (default) or pdf', nl: 'csv (standaard) of pdf' } }, { name: 'lang', in: 'query', enum: ['en', 'nl'], text: { en: 'Language of the report', nl: 'Taal van het rapport' } }],
    produces: 'text/csv',
    summary: { en: 'Download the statistics as CSV or PDF report', nl: 'Statistieken downloaden als CSV of pdf-rapport' },
  },
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
