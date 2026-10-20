# Changelog

**English** · [Nederlands](CHANGELOG.nl.md)

All notable changes per version. Versions follow [Semantic Versioning](https://semver.org/); test versions carry a suffix such as `-beta.1`.

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
