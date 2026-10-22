# Roadmap

**English** · [Nederlands](ROADMAP.nl.md)

Last updated: 22 October 2026. This roadmap is updated after every major build.

Legend: ✅ done · 🚧 in progress · 📋 planned

## Step 1: Foundation (v0.1) ✅

- ✅ Multi-tenant base: customers, users and roles (platform admin, customer admin, staff member)
- ✅ First-run setup wizard, invitations and password reset by e-mail
- ✅ Microsoft Entra ID single sign-on (optional, with a fallback for admins)
- ✅ Your own SMTP server: STARTTLS/TLS, minimum TLS version, OAuth 2.0, DKIM, test message
- ✅ Info button with version, update check, **stable and test release channels** and updating the whole installation from the web interface
- ✅ Automatic database backup before every update, with rollback when the update fails
- ✅ Bilingual (English and Dutch): interface, server messages and e-mails, language per user
- ✅ Modern admin interface in the RHIS house style (menu on the left, light/dark, mobile), "Powered by RHIS" and "Designed by RHIS"
- ✅ Installer for Debian 13 (VM/physical) and a Proxmox LXC script based on community-scripts
- ✅ CI (typecheck, tests, build) and a release workflow on GitHub

## Step 2: UniFi integration and hosting (v0.2) ✅

- ✅ Connect UniFi OS consoles (UDM, UDM Pro, UDM SE, UCG Ultra/Max, Cloud Gateway, UniFi Network Application)
  - through the UniFi Site Manager API with the customer's API key, so no ports need to be opened
  - a direct connection to the console as a fallback
- ✅ External portal endpoint: receive guests and recognise the customer by site and access point
- ✅ Give guests access with time, data and speed limits
- ✅ Caddy as reverse proxy with automatic Let's Encrypt per customer hostname (e.g. `guest.company.com`)
- ✅ Check that the A record points to the server before requesting a certificate
- ✅ Own hostname with automatic SSL for the main admin panel as well
- ✅ Step-by-step guide per console for connecting it (hotspot settings, pre-authorization)

## Step 3: Editor, registration, payments and notifications (v0.3) ✅

- ✅ Visual drag-and-drop portal editor with six templates, images, colours and fonts, per language, with a phone and desktop preview
- ✅ Guest portals in English and Dutch, chosen by the guest; the customer chooses which languages are offered
- ✅ Ways to connect: free with one tap, registration by e-mail (name, phone, marketing opt-in), vouchers and accepting the terms
- ✅ Vouchers in batches, with expiry, usage limits, own limits and a print sheet
- ✅ Paid access through Mollie or Stripe with packages, and a **time to pay** the customer sets (with a clear explanation)
- ✅ **Continue with Facebook** with the customer's own Facebook app
- ✅ **Notifications**
  - ✅ Alert as soon as the A record is validated and the SSL certificate is in place
  - ✅ Monthly report at the start of each month: guests, devices, registrations, vouchers, payments, revenue and peak times
- ✅ **E-mail template designer**, visual and in HTML, for every e-mail, per customer and platform-wide
- ✅ Guest list with name, e-mail, method, CSV export and removal

## Step 4: Billing customers (v0.4) ✅

- ✅ Plans and a subscription per customer (tenant) for their portal, set by the platform admin: plan, price, monthly/quarterly/yearly and start date; invoiced automatically in advance
- ✅ Invoices from the main admin panel, with gapless invoice numbers, VAT (or reverse charge), your company details and logo, as PDF and by e-mail; one-off invoices too
- ✅ Paying invoices online through the platform's own Mollie or Stripe account, with automatic payment status (webhooks plus a background check)
- ✅ Overview of outstanding, paid and overdue invoices, monthly recurring revenue, automatic reminders and marking bank transfers as paid
- ✅ Optional: pause a customer's guest portal automatically when an invoice stays unpaid, and resume it once paid
- ✅ Customers see, download and pay their own invoices in their environment
- ✅ Customers keep switching paid guest access on or off themselves (step 3)

## Step 5: Backups and guides (v0.5) 🚧

- ✅ Full and incremental backups (database per table and data folder per file), encrypted with AES-256-GCM
- ✅ Remote backup locations: SCP (SSH key or password, host key check), FTPS (explicit/implicit, TLS 1.2+) and FTP, plus a local folder
- ✅ Restore from the remote location, from the web interface, with a safety copy and automatic rollback
- ✅ Backup schedule and retention per location, e-mail when a backup fails
- ✅ Guide for backups, restore and disaster recovery
- 📋 Complete guides for customers and admins

## Step 6: Full API (v0.6) ✅

- ✅ Complete REST API for every customer (tenant) at `/api/v1`: consoles, hostnames, portal settings and design, guests, vouchers, payments and packages, notifications and guest e-mails, reports, team members and invoices
- ✅ Platform API for the main admin portal: create (with a first admin), change, suspend and delete customers, users, server settings, platform e-mail templates, billing, backups and updates
- ✅ API keys per customer and for the platform, with read/write scopes per part, expiry date and rate limit, created, changed, revoked and deleted in the interface; the key is shown once and stored hashed
- ✅ OpenAPI 3.1 documentation in English and Dutch with an interactive explorer in the interface, and `/api/v1/openapi.json` for other tools
- ✅ Signed webhooks (HMAC-SHA256) for guest authorized, payment received, hostname live, console offline/online, invoices, customers and backups, with retries, delivery log, test button and secret rotation
- ✅ Rate limiting and an audit trail per API key (every request for 90 days, plus the changes it made)

## Step 7: Guest experience, marketing and growth (v0.7) ✅

- ✅ **SMS verification** for guests with the customer's own Twilio or MessageBird account, with limits per guest, number and day
- ✅ **Google, Apple and Microsoft login** for guests, each with the customer's own app, sharing one tab with Facebook
- ✅ **Marketing and GDPR**: newsletter opt-in, export to Mailchimp and HubSpot (and CSV), a retention period, and guests' deletion requests confirmed by e-mail
- ✅ **Live dashboard** per customer: guests online per location and access point, today by hour against last week, sign-in methods and the latest sign-ins (data use per access point follows once the UniFi API offers it)
- ✅ **Survey after sign-in** with stars and a comment, followed by a Google review button
- ✅ **Ads or a splash video** before or after access, with views, clicks and a schedule
- ✅ **White label for resellers**: partners who manage their own customers under their own brand, logo, colour and admin address, with a customer limit and the RHIS mentions set per reseller
- ✅ **Monitoring**: an e-mail and webhook when a console or access point stays offline longer than the customer's threshold, and when it is back
- ✅ **Two-factor authentication (2FA)** for admins and customers, with recovery codes and policies per platform and per customer
- ✅ **Hotel/PMS link**: guests sign in with room number and surname until departure; stays by hand, CSV, API or synced from Apaleo and Mews

## Improvements after v0.7 🚧

- ✅ Better mail delivery: EHLO name, DKIM key generation and a deliverability check (0.7.2-beta.1)
- 🚧 **Generate login details** when creating a customer, reseller or user, shown once with a ready-made message for WhatsApp, and choosing an own password at first sign-in (0.7.2-beta.2, test channel)
- 🚧 **Platform statistics** for the platform admin: guests per reseller and customer, trend against the previous period, weekday × hour heatmap, active customers and devices, filters and CSV/PDF export, also in the platform API (0.7.3-beta.1, test channel)

## Later

- 📋 Entra SSO per customer (customers sign in with their own Microsoft tenant)
- 📋 More languages for the admin interface and guest portals (e.g. German and French)
