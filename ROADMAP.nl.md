# Roadmap

[English](ROADMAP.md) · **Nederlands**

Laatst bijgewerkt: 20 oktober 2026. Deze roadmap wordt na elke grote build bijgewerkt.

Legenda: ✅ klaar · 🚧 in ontwikkeling · 📋 gepland

## Stap 1: Fundament (v0.1) ✅

- ✅ Multi-tenant basis: klanten, gebruikers en rollen (platformbeheerder, klantbeheerder, medewerker)
- ✅ Eerste-installatiewizard, uitnodigen en wachtwoordherstel per e-mail
- ✅ Microsoft Entra ID single sign-on (optioneel, met fallback voor beheerders)
- ✅ Eigen SMTP-server: STARTTLS/TLS, minimale TLS-versie, OAuth 2.0, DKIM, testbericht
- ✅ Info-knop met versie, update-check, **stable- en test-releasekanaal** en de hele installatie bijwerken vanuit de webinterface
- ✅ Automatische databaseback-up voor elke update, met rollback als de update mislukt
- ✅ Tweetalig (Nederlands en Engels): interface, servermeldingen en e-mails, taal per gebruiker
- ✅ Moderne beheeromgeving in RHIS-huisstijl (menu links, licht/donker, mobiel), "Powered by RHIS" en "Designed by RHIS"
- ✅ Installer voor Debian 13 (VM/fysiek) en Proxmox LXC-script op basis van community-scripts
- ✅ CI (typecheck, tests, build) en release-workflow voor GitHub

## Stap 2: UniFi-koppeling en hosting 📋

- 📋 UniFi OS consoles koppelen (UDM, UDM Pro, UDM SE, UCG Ultra/Max, Cloud Gateway, UniFi Network Application)
  - via de UniFi Site Manager API met een API-sleutel van de klant, zodat er geen poorten open hoeven
  - directe verbinding met de console als terugvaloptie
- 📋 External portal endpoint: gasten opvangen, klant herkennen aan site en access point
- 📋 Gasten toegang geven met tijdslimiet, datalimiet en snelheidslimiet
- 📋 Caddy als reverse proxy met automatische Let's Encrypt per klant-hostname (bijv. `gast.bedrijf.nl`)
- 📋 Controle of het A-record naar de server wijst voordat een certificaat wordt aangevraagd
- 📋 Stap-voor-stap handleiding per console voor de koppeling (hotspot-instellingen, pre-authorization)

## Stap 3: Editor, registratie, betaling en notificaties 📋

- 📋 Visuele drag-and-drop portal-editor met sjablonen en eigen huisstijl per klant
- 📋 Gastportals in meerdere talen (minimaal Nederlands en Engels), taal kiezen door de gast
- 📋 Registratie via e-mail, vouchers of akkoord op voorwaarden
- 📋 Betaalde toegang via Mollie of Stripe
- 📋 **Notificaties**
  - 📋 Melding zodra het A-record gevalideerd is en het SSL-certificaat geregeld is
  - 📋 Maandrapportage aan het einde van de maand: aantal gasten, nieuwe registraties, betalingen en piekmomenten
- 📋 **Mail-template ontwerper**, zowel visueel als in HTML, voor uitnodigingen, meldingen en rapportages

## Stap 4: Backups en handleidingen 📋

- 📋 Volledige en incrementele back-ups (database en bestanden)
- 📋 Remote backuplocaties: FTP, FTPS en SCP
- 📋 Herstellen vanaf de remote locatie, vanuit de webinterface
- 📋 Back-upschema en bewaartermijnen
- 📋 Complete handleidingen voor klanten en beheerders

## Later

- 📋 Entra SSO per klant (klanten loggen in met hun eigen Microsoft-tenant)
- 📋 Tweestapsverificatie (TOTP) voor wachtwoordaccounts
- 📋 Extra talen voor beheeromgeving en gastportals (bijv. Duits en Frans)
