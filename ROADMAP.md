# Roadmap

**English** · [Nederlands](ROADMAP.nl.md)

Last updated: 21 October 2026. This roadmap is updated after every major build.

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

## Step 5: Backups and guides 📋

- 📋 Full and incremental backups (database and files)
- 📋 Remote backup locations: FTP, FTPS and SCP
- 📋 Restore from the remote location, from the web interface
- 📋 Backup schedule and retention
- 📋 Complete guides for customers and admins

## Step 6: Full API 📋

- 📋 Complete REST API for every customer (tenant): consoles, hostnames, portals, guests, payments and reports
- 📋 Platform API for the main admin portal: create, change, suspend and delete customers and their users
- 📋 API keys per customer and for the platform, with scopes (read/write) and expiry, created and revoked in the interface
- 📋 OpenAPI documentation with an interactive explorer (EN/NL)
- 📋 Webhooks for events such as guest authorized, payment received and certificate issued
- 📋 Rate limiting and an audit trail per API key

## Later

- 📋 Entra SSO per customer (customers sign in with their own Microsoft tenant)
- 📋 Two-factor authentication (TOTP) for password accounts
- 📋 More languages for the admin interface and guest portals (e.g. German and French)
