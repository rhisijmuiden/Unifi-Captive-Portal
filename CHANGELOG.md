# Changelog

**English** · [Nederlands](CHANGELOG.nl.md)

All notable changes per version. Versions follow [Semantic Versioning](https://semver.org/); test versions carry a suffix such as `-beta.1`.

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
