<p align="center">
  <img src="web/public/rhis-logo.svg" alt="RHIS" height="56">
</p>

<h1 align="center">Captive Portal</h1>

<p align="center"><b>English</b> · <a href="README.nl.md">Nederlands</a></p>

<p align="center">
  A hosted platform where multiple companies build and manage their own captive portal for UniFi guest Wi-Fi.<br>
  Designed by <a href="https://rhis.nl">RHIS</a>.
</p>

---

## What is it?

Captive Portal is a multi-tenant web application. You (the platform admin) host one server; your customers sign in, build their own guest portal in an editor, connect their UniFi OS console (UDM, UDM Pro, UCG Ultra, Cloud Gateway and more) and let guests register, optionally for a fee. Every customer can use their own hostname, such as `guest.company.com`, with an automatic Let's Encrypt certificate.

See the [roadmap](ROADMAP.md) for what works today and what is coming.

## What's included (v1.0)

- **UniFi integration**: connect UniFi OS consoles (UDM, UCG, Dream Router, Cloud Key, self-hosted Network) through the UniFi Site Manager cloud or directly, using the official UniFi Network API. Guests are recognised by access point and let through with time, data and speed limits.
- **Guest portal** as external portal server, designed in a **drag-and-drop portal editor** with templates, images, colours and fonts, in English and Dutch (the customer picks the languages, the guest picks one).
- **Ways to connect**: free with one tap, registration by e-mail (with marketing opt-in), **vouchers** with a print sheet, **paid access** through Mollie or Stripe with packages and an adjustable time to pay, **SMS code** (Twilio or MessageBird), **hotel login** with room number and surname (by hand, CSV, API, Apaleo or Mews), and **Continue with Facebook, Google, Apple or Microsoft**.
- **Marketing and GDPR**: newsletter opt-ins with export to **Mailchimp** or **HubSpot** (automatic or by hand) and CSV, a retention period for guests without opt-in, and a **Privacy** link on every guest page where guests ask for their data to be erased (confirmed by e-mail, also removed at the newsletter provider).
- **Feedback and ads**: a star rating with comment after signing in, followed by a **Google review** button, and **ads or a splash video** before or after sign-in with views, clicks and a schedule.
- **White-label resellers**: partners who sell the platform under their own brand and manage their own customers, with their own logo, colour, support address and optionally their own admin address with SSL. Per reseller you set the customer limit and whether "Powered by RHIS" and "Designed by RHIS" stay visible.
- **Billing customers** from the main admin panel: plans and subscriptions per customer, invoices with gapless numbers, VAT and your logo as PDF and e-mail, online payment through your own Mollie or Stripe account, reminders, and optionally pausing a customer's guest portal while invoices stay unpaid. Customers see and pay their invoices in their own environment.
- **Backups and restore**: encrypted (AES-256) full and incremental backups of the database and data folder to **SCP**, **FTPS**, FTP or a local folder, on a schedule per location with retention, and restoring from the remote location in the web interface with a safety copy and automatic rollback.
- **Full REST API and webhooks**: a customer API for everything in a customer's environment and a platform API for customers, users, server settings, billing, backups and updates. API keys with read/write scopes, expiry and rate limit, an audit trail per key, signed webhooks with retries, and OpenAPI documentation in English and Dutch with an explorer to try it out.
- **Platform statistics** for the platform admin: guest sign-ins, unique devices and active customers across all resellers and customers, a trend against the previous period, a weekday × hour heatmap of busy moments, per reseller and per customer, filters for period, reseller and customer, and export as CSV or PDF report.
- **Notifications and reports**: an e-mail as soon as a hostname is live (A record validated and SSL in place) and a monthly report with guests, registrations, payments and peak times.
- **Monitoring and live dashboard**: consoles are checked every 5 minutes, with an e-mail (and webhook) when a console or access point stays offline and when it is back. A live dashboard per customer shows guests online, today by hour against last week, sign-in methods, guests per access point and the latest sign-ins.
- **E-mail template designer**: every e-mail, visual or in HTML, per language, per customer and platform-wide.
- **Own hostnames with automatic SSL**: Caddy on ports 80/443 with on-demand Let's Encrypt certificates, only after the DNS record has been verified. The admin panel can get its own HTTPS hostname too.
- **Customers (tenants) and users** with four roles: platform admin, reseller admin, customer admin and staff member. Invite by e-mail, or generate login details (shown once, with a ready-made message to paste into WhatsApp) and have the user choose their own password at first sign-in. The platform admin manages customers and the server (public IP, admin hostname and SSL, e-mail, SSO); consoles, portals, hostnames and guests live in each customer's own environment.
- **Microsoft Entra ID single sign-on** (OpenID Connect with PKCE), next to or instead of password sign-in.
- **Two-factor authentication** with an authenticator app (TOTP) and recovery codes, which the platform admin can require for platform admins and customers, and customers for their own team.
- **Your own mail server (SMTP)**: STARTTLS or TLS, minimum TLS version, username/password or OAuth 2.0 (Microsoft 365), DKIM signing and a test button.
- **Info & updates**: current version, check for updates, choose between the **stable** and **test** channel, and **update the whole installation** (app plus Debian packages) from the web interface, with an automatic database backup and rollback.
- **Bilingual**: English and Dutch in the interface, error messages and e-mails. Every user picks a language; new languages are added with one translation file.
- **Modern admin interface** in the RHIS house style: menu on the left, light and dark theme, works on phones.
- **Installation** as a Proxmox LXC (Debian 13) or on a Debian 13 VM or physical server. The web interface runs on **port 8080**.

## Install

| Where | Command |
| --- | --- |
| **Proxmox LXC** (on the Proxmox host) | `bash -c "$(curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main/ct/captive-portal.sh)"` |
| **Debian 13 VM or server** (as root) | `bash -c "$(curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main/install/install.sh)"` |

Then open `http://<server-ip>:8080` and create the first administrator account. Ports 80 and 443 are used by Caddy for the guest portals and HTTPS. Detailed steps are in [docs/en/installation.md](docs/en/installation.md).

## Guides

- [Installation](docs/en/installation.md): LXC, VM and physical server, first start, configuration file
- [Connecting a UniFi console](docs/en/unifi-setup.md): Site Manager or direct, hotspot settings, pre-authorization, troubleshooting
- [Hostnames and SSL](docs/en/hostnames-ssl.md): DNS records, automatic certificates, HTTPS for the admin panel
- [Portal editor](docs/en/portal-editor.md): blocks, templates, images and languages
- [Guest access](docs/en/guest-access.md): sign-in methods, vouchers, Mollie and Stripe, time to pay, Facebook login, pre-authorization
- [SMS and Google, Apple and Microsoft login](docs/en/sms-social-login.md): Twilio, MessageBird, your own Google, Entra and Apple apps
- [Hotel login](docs/en/hotel-login.md): room number and surname, CSV import, Apaleo and Mews
- [Newsletter, GDPR, feedback and ads](docs/en/marketing-feedback-ads.md): Mailchimp, HubSpot, deletion requests, survey, Google review, splash video
- [Notifications, monitoring, live dashboard, reports and e-mail templates](docs/en/notifications-mail.md)
- [Security, login details and two-factor authentication](docs/en/security.md): generated login details, authenticator app, recovery codes, required 2FA, lost phone
- [White-label resellers](docs/en/resellers.md): partners with their own brand, customer limit, own admin address and RHIS mentions per reseller
- [Platform statistics](docs/en/statistics.md): guests per reseller and customer, busy moments, trends, CSV and PDF export
- [Billing customers](docs/en/billing.md): plans, subscriptions, invoices, online payment, reminders and pausing portals
- [Backups and restore](docs/en/backups.md): SCP, FTPS and FTP locations, schedule, encryption, restore and disaster recovery
- [API and webhooks](docs/en/api.md): API keys and scopes, customer and platform API, rate limits, webhooks and signatures, OpenAPI
- [Updating and release channels](docs/en/updating.md): stable and test, updating from the interface or the terminal, rollback
- [Microsoft Entra SSO](docs/en/entra-sso.md): app registration and setup
- [E-mail (SMTP)](docs/en/smtp.md): Microsoft 365, Google Workspace, your own server, DKIM
- [Development and releases](docs/en/development.md): running locally, project layout, translations, publishing a release

## Technology

| Part | Choice |
| --- | --- |
| Backend | Node.js 24, TypeScript, Fastify 5 |
| Database | PostgreSQL (Debian 13 ships version 17) with Drizzle ORM and migrations |
| Frontend | React 19, Vite, Tailwind CSS 4, TanStack Query, i18next |
| Sign-in | Argon2id passwords, database sessions, Entra ID through OpenID Connect |
| Security | Secrets stored encrypted (AES-256-GCM), CSRF protection, rate limiting, systemd hardening |
| Reverse proxy and SSL | Caddy with on-demand Let's Encrypt per hostname, approved by the app |
| UniFi | Official UniFi Network Integration API, through Site Manager (api.ui.com) or directly |
| Editors | dnd-kit (drag and drop), CodeMirror 6 (HTML) |
| Payments | Mollie and Stripe REST APIs with verified webhooks |
| Invoices | PDFKit (PDF generated on the server, no browser needed) |

## License

© RHIS. All rights reserved.
