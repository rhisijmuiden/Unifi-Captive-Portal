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

## What's included (v0.3)

- **UniFi integration**: connect UniFi OS consoles (UDM, UCG, Dream Router, Cloud Key, self-hosted Network) through the UniFi Site Manager cloud or directly, using the official UniFi Network API. Guests are recognised by access point and let through with time, data and speed limits.
- **Guest portal** as external portal server, designed in a **drag-and-drop portal editor** with templates, images, colours and fonts, in English and Dutch (the customer picks the languages, the guest picks one).
- **Ways to connect**: free with one tap, registration by e-mail (with marketing opt-in), **vouchers** with a print sheet, **paid access** through Mollie or Stripe with packages and an adjustable time to pay, and **Continue with Facebook**.
- **Notifications and reports**: an e-mail as soon as a hostname is live (A record validated and SSL in place) and a monthly report with guests, registrations, payments and peak times.
- **E-mail template designer**: every e-mail, visual or in HTML, per language, per customer and platform-wide.
- **Own hostnames with automatic SSL**: Caddy on ports 80/443 with on-demand Let's Encrypt certificates, only after the DNS record has been verified. The admin panel can get its own HTTPS hostname too.
- **Customers (tenants) and users** with three roles: platform admin, customer admin and staff member. Invitations by e-mail. The platform admin manages customers and the server (public IP, admin hostname and SSL, e-mail, SSO); consoles, portals, hostnames and guests live in each customer's own environment.
- **Microsoft Entra ID single sign-on** (OpenID Connect with PKCE), next to or instead of password sign-in.
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
- [Notifications, reports and e-mail templates](docs/en/notifications-mail.md)
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

## License

© RHIS. All rights reserved.
