# Changelog

**English** · [Nederlands](CHANGELOG.nl.md)

All notable changes per version. Versions follow [Semantic Versioning](https://semver.org/); test versions carry a suffix such as `-beta.1`.

## [0.7.2-beta.1] - 2026-10-21 (test channel)

Fix for outgoing mail being marked as spam (`HELO_MISC_IP`, `KAM_DMARC_QUARANTINE`, `SPF_NONE`).

- The app now greets the mail server with a real hostname instead of `[127.0.0.1]`. New **EHLO name** setting under **E-mail (SMTP) → Sender**; empty uses the admin hostname or the server's FQDN.
- **DKIM**: **Generate key** creates a 2048-bit key, stores it encrypted and shows the TXT record to publish. Pasting your own key still works.
- New **Deliverability check** card: checks the EHLO name and the SPF, DKIM and DMARC records of the sender domain, explains what is wrong and suggests the records to add.
- Guide: [E-mail (SMTP)](docs/en/smtp.md#keeping-mail-out-of-spam) explains SPF, DKIM and DMARC.

## [0.7.1] - 2026-10-21

Stable release of the Caddy fixes, identical to 0.7.1-beta.2: the SSL service (Caddy) status card under Hosting & SSL, and `install/caddy.sh` replacing the Caddy package's sample Caddyfile so Caddy serves HTTPS on port 443.

## [0.7.1-beta.2] - 2026-10-21 (test channel)

- Fix: on a new server Caddy only listened on port 80, so certificates were never issued (*The SSL service (Caddy) on the server does not respond*). `install/caddy.sh` kept the sample Caddyfile that the Caddy package installs, because it took it for a hand-made one. It now replaces that sample with the platform's configuration. Existing servers are repaired by the update.

## [0.7.1-beta.1] - 2026-10-21 (test channel)

Fix for *The SSL service (Caddy) on the server does not respond*.

- **Hosting & SSL** now has an **SSL service (Caddy)** card that shows whether Caddy listens on ports 443 and 80 and runs this app's configuration, with the commands to repair it when it does not.
- `install/caddy.sh` (run by the installer and every update) checks the configuration with the stored Let's Encrypt e-mail address, so updates no longer fail on it; it stops with a clear message when another web server holds port 80 or 443, waits until Caddy really listens and shows Caddy's log when it does not. It no longer installs the unneeded `debian-keyring` and `apt-transport-https` packages.
- The message for customers now points the platform admin to **Hosting & SSL**.
- Guide: [Hostnames and SSL](docs/en/hostnames-ssl.md#when-caddy-does-not-respond) has a troubleshooting section.

## [0.7.0] - 2026-10-21

Stable release of step 7 (SMS and social login, hotel login, two-factor authentication, monitoring, live dashboard, marketing and GDPR, feedback, ads and white-label resellers), identical to 0.7.0-beta.4.

## [0.7.0-beta.4] - 2026-10-21 (test channel)

Step 7, part 4: white-label resellers. This completes step 7.

- **Resellers** (new page **Resellers** in the main admin panel): partners who sell the platform to their own customers under their own brand. Per reseller: company details, an optional **customer limit**, an optional **own admin address** (with an automatic Let's Encrypt certificate), the brand (name, logo for light and dark backgrounds, accent colour, website, support e-mail) and a first admin who is invited by e-mail.
- **RHIS mentions per reseller**: choose whether **Powered by RHIS** (menu and Info, default on) and **Designed by RHIS** (admin panel, the customers' guest portals and e-mails, default off) stay visible.
- **Reseller admin panel** with a new role *Reseller admin*: an overview of its own customers, **Customers** (create, change, suspend, delete, within the limit), **Team** (own colleagues and the customers' teams) and **Branding** with a preview. Like the platform admin, a reseller does not see its customers' consoles, portals or guests.
- The reseller's customers see its brand in their admin panel (logo, accent colour, tab title, support e-mail under Info and on the sign-in page); on its own admin address the brand shows before signing in too. Invitation and password e-mails link to that address.
- **Suspending** a reseller closes the admin panel and the API for its team and all its customers right away; guest portals keep working. A reseller can only be deleted once it has no customers. Sign-in, two-factor, password reset and Microsoft sign-in all refuse suspended customers and resellers.
- The platform admin assigns existing customers to a reseller (or back) when editing the customer.
- API: new platform scope `resellers` and `resellerId` on customers.
- New guide: [White-label resellers](docs/en/resellers.md).

## [0.7.0-beta.3] - 2026-10-21 (test channel)

Step 7, part 3: marketing, GDPR, feedback and ads. Three new pages under **Marketing** in the customer's environment.

- **Newsletter & GDPR**: every guest who signs in with an e-mail address becomes a contact (name, visits, last visit); the opt-in box now also appears on the **Account** tab for Google, Apple, Microsoft and Facebook. Export to **Mailchimp** (audience, optional double opt-in, tag `wifi`) or **HubSpot** (private app), automatically right away and every 15 minutes or with **Send now**, with a status per contact and a **Test connection** button. **Download CSV** of the opt-ins or all contacts.
- **Retention**: name, e-mail and phone of guests without opt-in can be erased automatically after 30 days to 2 years; statistics stay anonymous.
- **Deletion requests**: a **Privacy** link on every guest page. The guest gets a confirmation e-mail (new template *Erase request (guests)*, valid 48 hours) and after confirming everything about the address is erased, also at Mailchimp or HubSpot. Admins can erase an address themselves; all requests are listed, without keeping the address.
- **Feedback**: an optional question with 1 to 5 stars and a comment on the *You are connected* page, then a **Google review** button for every guest. Average, distribution per star and comments for 30, 90 or 365 days.
- **Ads and splash video**: images (2 MB) or MP4/WebM videos (25 MB) before sign-in (once per visit, with a **Continue** button after a set number of seconds, no JavaScript needed) or after sign-in (with a counted click-through link). Optional period, pause, a random pick between active ads, and views, clicks and click rate per day. Videos are streamed with range requests.
- The *You are connected* page only says it will redirect when it really does.
- API: new customer scope `marketing` for all of the above.
- New guide: [Newsletter, GDPR, feedback and ads](docs/en/marketing-feedback-ads.md).

## [0.7.0-beta.2] - 2026-10-21 (test channel)

Step 7, part 2: more ways for guests to sign in.

- **SMS verification**: guests type a mobile number and the six-digit code from the text. Sent with the customer's own **Twilio** or **MessageBird** account; default country code for numbers like `06 12345678`, a test message button and the number of texts this month. Codes are valid 10 minutes with 5 tries; at most 3 codes per guest, 5 per number per hour and a daily maximum per customer.
- **Google, Apple and Microsoft login**, each with the customer's own app (Google OAuth client, Microsoft Entra app registration, Apple Services ID with a `.p8` key), with the redirect address to copy, step-by-step instructions and a **Test connection** button. On the guest portal all social sign-ins share one **Account** tab with a button each. The short access to sign in and the walled-garden domains are now shared by all providers.
- **Hotel login**: guests sign in with room number and surname and stay online until departure, with a limit of devices per room and a lock after 5 wrong surnames. New **Hotel** page with the stays in house, expected and all, add and edit by hand, **CSV import** from any PMS, the API (`/api/v1/hotel/…`, new scope `hotel`) and a **PMS connection** with **Apaleo** and **Mews** that syncs every 10 minutes (and right away when a guest's room is not found yet).
- Live dashboard, guest list and reports know the new sign-in methods.
- Fix: changing only some settings through the API (or a settings card) no longer resets the other fields of that group to their defaults.
- New guides: [SMS and social login](docs/en/sms-social-login.md) and [Hotel login](docs/en/hotel-login.md).

## [0.7.0-beta.1] - 2026-10-21 (test channel)

Step 7, part 1: security, monitoring and a live dashboard.

- **Two-factor authentication** for everyone: turn it on under **My account** with any authenticator app (QR code or key), confirm with a code, and keep ten one-time **recovery codes** (copy or download; new set at any time). After the password a code is asked; a code works only once, and too many wrong codes pause the account for 15 minutes. A password reset still asks for the code.
- **Required 2FA**: the platform admin requires it under the new **System → Security** page for platform admins and/or customers (admins or everyone); customer admins can require it for their own team on the **Team** page. Whoever must use it gets the set-up screen right after signing in. Microsoft (Entra) sign-ins count as two-factor by default (switchable). Admins can **reset** a user's 2FA when the phone and codes are lost; users show a **2FA** badge.
- **Monitoring**: consoles are now checked every 5 minutes (was hourly), including the state of every access point. Under **Notifications → Monitoring** customers choose e-mails for *console offline* and *access point offline* and after how many minutes (default 10); a second e-mail follows when it is back, with the duration. New e-mail templates and webhooks `device.offline` / `device.online`.
- **Live dashboard** (new **Insights → Live** page): guests online per location and per access point, connections and unique devices today versus the same day last week, the last hour, today by hour with last week as comparison, sign-in methods, the latest sign-ins and the state of consoles and access points, refreshed every 10 seconds. Also in the API as `GET /api/v1/live`.
- API: two-factor policy (`/security-settings`), resetting a user's 2FA and the live figures.
- New guide: [Security and two-factor authentication](docs/en/security.md); monitoring and the live dashboard are in [Notifications](docs/en/notifications-mail.md).

## [0.6.0-beta.1] - 2026-10-21 (test channel)

Step 6: full API.

- **REST API** at `/api/v1` with API keys (`Authorization: Bearer cpk_…`). It uses the same routes and checks as the web interface, so everything stays in line.
  - **Customer API**: consoles, hostnames, portal settings and design, images, Facebook login, guests (including GDPR deletion), vouchers, payment settings and packages, payments, notifications and guest e-mail templates, overview and monthly report, team members and invoices (PDF too).
  - **Platform API**: customers (create with a first admin, change, suspend, delete), users, server settings (SMTP, SSO, system, hosting, billing settings), platform e-mail templates, billing (plans, subscriptions, invoices), backups (locations, run now; restoring stays in the web interface) and updates.
- **API keys** under the new **API** menu item (customer admins) and **System → API** (platform admin): read/write scopes per part, expiry date (30/90/365 days, a date or never), requests per minute, edit, revoke and delete. The key is shown once and stored as a SHA-256 hash; keys stop working when their customer is suspended.
- **Rate limiting** per key per minute with `X-RateLimit-*` headers and `429`, plus a limit on failed key attempts per address.
- **Audit trail per key**: every request (method, path, status, duration, IP) for 90 days, and changes made through the API are logged with the key.
- **Webhooks**: signed (HMAC-SHA256 over timestamp and body) messages for `guest.authorized`, `payment.paid`, `hostname.active`, `console.offline`/`console.online` and `invoice.issued`/`invoice.paid` (customers) and `tenant.created`/`updated`/`deleted`, invoices and `backup.succeeded`/`failed` (platform). Retries after 1 min to 24 h, switched off after 50 failures in a row, delivery log with answers, **Test**, **Send again**, show and replace the signing secret. Customer webhooks only call public `https://` addresses (checked again when connecting, so DNS cannot point them at the internal network).
- **Documentation**: OpenAPI 3.1 in English and Dutch with an explorer in the interface (search, parameters, example bodies, try it with a key, cURL), downloadable and public at `/api/v1/openapi.json`.
- New guide: [API and webhooks](docs/en/api.md).
- Roadmap: new step 7 with guest experience, marketing and growth ideas.

## [0.5.0-beta.1] - 2026-10-21 (test channel)

Step 5: backups and restore.

- **Backups** (new menu item under System for the platform admin): the complete database and the data folder, including `APP_SECRET`, so a backup can be restored on a new server.
- **Full and incremental**: an incremental backup only sends the database tables and files that changed since the previous backup; restoring one gives the complete state of that moment.
- **Locations**: SCP over SSH (with this server's own ed25519 key or a password, host key remembered and checked), FTPS (explicit or implicit TLS, at least TLS 1.2, certificate check), FTP and a local folder. Test connection button that writes and reads a test file.
- **Encryption** with AES-256-GCM and a key derived (scrypt) from your passphrase; every part is checked with SHA-256 on restore.
- **Schedule and retention per location**: full every day/week/month at a set hour, incrementals every 1/6/12/24 hours in between, keep the newest *n* full backups. Failed backups are retried after 30 minutes and e-mailed to the platform admins (new template *Backup failed*). History of the last 50 backups.
- **Restore** from the remote location in the web interface: passphrase and version checked first, everything downloaded and verified, then the system service stops the app, saves the current state, replaces the database in one transaction, puts back the data folder and `APP_SECRET`, and starts again, rolling back automatically if the app does not come up.
- New guide: [Backups and restore](docs/en/backups.md).

## [0.4.0-beta.1] - 2026-10-21 (test channel)

Step 4: billing customers from the main admin panel.

- **Billing** (new menu item for the platform admin) with four tabs: invoices, subscriptions, plans and settings.
- **Plans and subscriptions**: reusable plans (price excl. VAT, monthly/quarterly/yearly) and a billing profile per customer with invoice address, invoice e-mail, VAT number, reference, language, VAT rate or reverse charge, and the subscription (plan, own price, period, start date, next invoice date).
- **Invoices**: subscription invoices are created automatically in advance for every period (hourly job, catches up after downtime); one-off invoices by hand. Drafts can be edited; issuing assigns a gapless number (prefix with `{year}`, adjustable digits), invoice and due date, and freezes your company and customer details. Cancel instead of delete; invoices are kept when a customer is deleted.
- **PDF and e-mail**: A4 invoice PDF in English or Dutch with your logo (PNG, JPG or SVG), company details, lines, VAT, payment instructions and footer; e-mailed with the PDF attached. New e-mail templates *Invoice*, *Payment reminder* and *Payment received*.
- **Online payment** through the platform's own Mollie or Stripe account: a public pay page per invoice (link in the e-mail and in the customer environment), webhooks plus a background check every minute, automatic confirmation.
- **Overdue invoices**: automatic reminders (for example 7 and 14 days after the due date), marking bank transfers as paid, and optionally pausing the customer's guest portal after a number of days overdue. The customer can still sign in and pay; the portal resumes automatically, or by hand with **Resume portal**.
- **Customer environment**: new **Invoices** page for customer admins with what is due, the subscription, all invoices with PDF and a Pay button, and a notice on the dashboard while the portal is paused.
- Customers page: shortcut to a customer's billing and subscription.
- New guide: [Billing customers](docs/en/billing.md).

## [0.3.0-beta.2] - 2026-10-20 (test channel)

- New customer: optionally fill in the first administrator (name and e-mail address). They get the invitation e-mail right away and sign in at the same address as the admin panel. If the e-mail cannot be sent, you see why.

## [0.3.0-beta.1] - 2026-10-20 (test channel)

Step 3: editor, registration, payments and notifications.

- **Portal editor**: drag-and-drop page builder with logo, icon, heading, text, image, link button, divider and spacing blocks, six templates, colours, background, fonts and card style, texts per language, phone and desktop preview. The editor and the guest page share one renderer.
- **Access & sign-in** (replaces *Portal settings*): free, e-mail registration (name and phone off/optional/required, marketing opt-in, welcome e-mail), vouchers, payment and Facebook, shown as tabs on the guest page; the languages the portal offers.
- **Vouchers**: batches with time, usage limit, expiry and own limits; readable codes; revoke, delete and a print sheet.
- **Payments** through Mollie or Stripe with the customer's own account: packages, transactions with totals, webhooks plus a background check, receipt e-mail, and an adjustable **time to pay** (0–30 minutes) with an explanation on screen.
- **Continue with Facebook**: guests sign in with Facebook through the customer's own Facebook app, with an adjustable time to log in.
- **Notifications**: e-mail when a hostname is live (A record validated and SSL in place) and a monthly report, to admins and/or own addresses, with a log and automatic retries.
- **Reports**: monthly figures with comparisons, guests per day, hour, method and site.
- **E-mail template designer**: every e-mail visual or in HTML, per language; customers for their guest and notification e-mails, the platform admin for all e-mails.
- **Guests**: name, e-mail, method, voucher or package, CSV export and removal.
- Roadmap: new step 4, billing customers from the main admin panel; backups move to step 5 and the API to step 6.
- New guides: portal editor; guest access (vouchers, payments, Facebook, pre-authorization); notifications, reports and e-mail templates.

## [0.2.1-beta.1] - 2026-10-20 (test channel)

- The platform admin panel now only manages customers and the server: tenants, users, e-mail, SSO and Hosting & SSL. UniFi consoles, portal settings, hostnames and guests are only available in the customer's own environment, and the API refuses them for platform admins. The customer picker on those pages is gone.
- Dashboard for the platform admin: the step "Connect a UniFi console" is replaced by "Invite a customer administrator".
- The menu shows the platform API (step 5) as coming soon.

## [0.2.0] - 2026-10-20

Stable release of step 2, identical to 0.2.0-beta.2.

## [0.2.0-beta.2] - 2026-10-20 (test channel)

- Fix: updating from the interface failed with `vite: not found`. The update script exported the whole configuration file, including `NODE_ENV=production`, so `npm ci` skipped the build tools. It now reads only the database URL and always installs build tools.

## [0.2.0-beta.1] - 2026-10-20 (test channel)

Step 2: UniFi integration and hosting.

- Connect UniFi OS consoles through UniFi Site Manager (no open ports) or directly, with a connect wizard, site selection and an hourly access-point refresh
- External portal endpoint: guests are matched to the right customer by access point and authorized through the UniFi Network API with time, data and speed limits
- Bilingual guest page (English/Dutch, chosen by the guest) with own title, welcome text, terms and accent colour; settings page with live preview
- Guests overview with online-now and today counters
- Own hostnames per customer with DNS verification, on-demand Let's Encrypt certificates through Caddy and automatic retries
- Admin panel on its own HTTPS hostname (Hosting & SSL), with HTTP → HTTPS redirect; links in e-mails and SSO use it
- Installer and updater set up Caddy on ports 80/443 (`CP_ACME_EMAIL`, `CP_CADDY=0`)
- Guides: connecting a UniFi console, hostnames and SSL
- Roadmap: step 5, a full API for customers and the platform
- Releases are published automatically when a new version is merged into `main`

## [0.1.0] - 2026-10-20

First version: the foundation of the platform.

- Customers, users and roles, first-run setup wizard, invitations and password reset
- Microsoft Entra ID single sign-on
- SMTP settings with STARTTLS/TLS, OAuth 2.0, DKIM and a test message
- Info & updates with stable and test channels, and updating the whole installation from the web interface
- Installer for Debian 13 and a Proxmox LXC script
- Admin interface in the RHIS house style
- Bilingual: English and Dutch, language per user
