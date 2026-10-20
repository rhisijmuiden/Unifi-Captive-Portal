# Changelog

[English](CHANGELOG.md) · **Nederlands**

Alle noemenswaardige wijzigingen per versie. Versies volgen [Semantic Versioning](https://semver.org/lang/nl/); testversies hebben een achtervoegsel zoals `-beta.1`.

## [0.2.0-beta.2] - 2026-10-20 (test-kanaal)

- Fix: updaten vanuit de interface mislukte met `vite: not found`. Het updatescript exporteerde het hele configuratiebestand, inclusief `NODE_ENV=production`, waardoor `npm ci` de bouwtools oversloeg. Het leest nu alleen de database-URL en installeert de bouwtools altijd.

## [0.2.0-beta.1] - 2026-10-20 (test-kanaal)

Stap 2: UniFi-koppeling en hosting.

- UniFi OS consoles koppelen via UniFi Site Manager (geen open poorten) of rechtstreeks, met een koppelwizard, sitekeuze en elk uur verversen van de access points
- External portal endpoint: gasten worden aan het access point herkend bij de juiste klant en via de UniFi Network API doorgelaten met limieten voor tijd, data en snelheid
- Tweetalige gastpagina (Nederlands/Engels, de gast kiest) met eigen titel, welkomsttekst, voorwaarden en accentkleur; instellingenpagina met live voorbeeld
- Gastenoverzicht met tellers voor nu online en vandaag
- Eigen hostnamen per klant met DNS-controle, Let's Encrypt-certificaten op aanvraag via Caddy en automatisch opnieuw proberen
- Beheerpaneel op een eigen HTTPS-hostnaam (Hosting & SSL), met doorsturen van HTTP naar HTTPS; links in e-mails en SSO gebruiken die hostnaam
- Installer en updater richten Caddy in op poort 80/443 (`CP_ACME_EMAIL`, `CP_CADDY=0`)
- Handleidingen: een UniFi-console koppelen, hostnamen en SSL
- Roadmap: stap 5, een volledige API voor klanten en het platform
- Releases worden automatisch gepubliceerd zodra een nieuwe versie in `main` wordt gemerged

## [0.1.0] - 2026-10-20

Eerste versie: het fundament van het platform.

- Klanten, gebruikers en rollen, eerste-installatiewizard, uitnodigingen en wachtwoordherstel
- Microsoft Entra ID single sign-on
- SMTP-instellingen met STARTTLS/TLS, OAuth 2.0, DKIM en testbericht
- Info & updates met stable- en testkanaal en updaten van de volledige installatie vanuit de webinterface
- Installer voor Debian 13 en Proxmox LXC-script
- Beheeromgeving in RHIS-huisstijl
- Tweetalig: Nederlands en Engels, taal per gebruiker
