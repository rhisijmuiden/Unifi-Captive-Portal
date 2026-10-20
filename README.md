<p align="center">
  <img src="web/public/rhis-logo.svg" alt="RHIS" height="56">
</p>

<h1 align="center">Captive Portal</h1>

<p align="center">
  Een gehost platform waarop meerdere bedrijven hun eigen captive portal voor UniFi-gastwifi bouwen en beheren.<br>
  Designed by <a href="https://rhis.nl">RHIS</a>.
</p>

---

## Wat is het?

Captive Portal is een multi-tenant webapplicatie. Jij (de platformbeheerder) host één server; je klanten loggen in, bouwen hun eigen gastportal in een editor, koppelen hun UniFi OS console (UDM, UDM Pro, UCG Ultra, Cloud Gateway, enz.) en laten gasten registreren, eventueel tegen betaling. Elke klant kan een eigen hostname gebruiken, zoals `gast.bedrijf.nl`, met automatisch een Let's Encrypt-certificaat.

Zie de [roadmap](ROADMAP.md) voor wat er al werkt en wat eraan komt.

## Wat zit er nu in (v0.1)

- **Klanten (tenants) en gebruikers** met drie rollen: platformbeheerder, klantbeheerder en medewerker. Uitnodigen per e-mail.
- **Microsoft Entra ID single sign-on** (OpenID Connect met PKCE), naast of in plaats van inloggen met wachtwoord.
- **Eigen mailserver (SMTP)**: STARTTLS of TLS, minimale TLS-versie, gebruikersnaam/wachtwoord of OAuth 2.0 (Microsoft 365), DKIM-ondertekening en een testknop.
- **Info & updates**: huidige versie, controleren op updates, kiezen tussen het **stable**- en **test**-kanaal, en de **hele installatie bijwerken** (app plus Debian-pakketten) vanuit de webinterface, met automatische databaseback-up en rollback.
- **Moderne beheeromgeving** in de RHIS-huisstijl: menu links, licht en donker thema, werkt op telefoon.
- **Installatie** als Proxmox LXC (Debian 13) of op een Debian 13 VM of fysieke server. De webinterface draait op **poort 8080**.

## Installeren

| Waar | Commando |
| --- | --- |
| **Proxmox LXC** (op de Proxmox-host) | `bash -c "$(curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main/ct/captive-portal.sh)"` |
| **Debian 13 VM of server** (als root) | `bash -c "$(curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main/install/install.sh)"` |

Open daarna `http://<ip-van-de-server>:8080` en maak het eerste beheerdersaccount aan. Uitgebreide stappen staan in [docs/installatie.md](docs/installatie.md).

## Handleidingen

- [Installatie](docs/installatie.md): LXC, VM en fysieke server, eerste start, configuratiebestand
- [Updaten en releasekanalen](docs/updaten.md): stable en test, updaten vanuit de interface of de terminal, rollback
- [Microsoft Entra SSO](docs/entra-sso.md): app-registratie en koppeling
- [E-mail (SMTP)](docs/smtp.md): Microsoft 365, Google Workspace, eigen server, DKIM
- [Ontwikkelen en releasen](docs/ontwikkelen.md): lokaal draaien, projectstructuur, een release publiceren

## Techniek

| Onderdeel | Keuze |
| --- | --- |
| Backend | Node.js 24, TypeScript, Fastify 5 |
| Database | PostgreSQL (Debian 13 levert versie 17) met Drizzle ORM en migraties |
| Frontend | React 19, Vite, Tailwind CSS 4, TanStack Query |
| Inloggen | Argon2id-wachtwoorden, sessies in de database, Entra ID via OpenID Connect |
| Beveiliging | Geheimen versleuteld opgeslagen (AES-256-GCM), CSRF-bescherming, rate limiting, systemd-hardening |
| Reverse proxy en SSL (stap 2) | Caddy met automatische Let's Encrypt per klant-hostname |

## Licentie

© RHIS. Alle rechten voorbehouden.
