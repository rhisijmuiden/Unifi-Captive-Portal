# Roadmap

[English](ROADMAP.md) · **Nederlands**

Laatst bijgewerkt: 21 oktober 2026. Deze roadmap wordt na elke grote build bijgewerkt.

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

## Stap 2: UniFi-koppeling en hosting (v0.2) ✅

- ✅ UniFi OS consoles koppelen (UDM, UDM Pro, UDM SE, UCG Ultra/Max, Cloud Gateway, UniFi Network Application)
  - via de UniFi Site Manager API met een API-sleutel van de klant, zodat er geen poorten open hoeven
  - directe verbinding met de console als terugvaloptie
- ✅ External portal endpoint: gasten opvangen, klant herkennen aan site en access point
- ✅ Gasten toegang geven met tijdslimiet, datalimiet en snelheidslimiet
- ✅ Caddy als reverse proxy met automatische Let's Encrypt per klant-hostname (bijv. `gast.bedrijf.nl`)
- ✅ Controle of het A-record naar de server wijst voordat een certificaat wordt aangevraagd
- ✅ Ook het hoofdbeheerpaneel op een eigen hostnaam met automatisch SSL
- ✅ Stap-voor-stap handleiding per console voor de koppeling (hotspot-instellingen, pre-authorization)

## Stap 3: Editor, registratie, betaling en notificaties (v0.3) ✅

- ✅ Visuele drag-and-drop portal-editor met zes templates, afbeeldingen, kleuren en lettertypen, per taal, met voorbeeld op telefoon en desktop
- ✅ Gastportals in Nederlands en Engels, taal kiezen door de gast; de klant kiest welke talen worden aangeboden
- ✅ Manieren van verbinden: gratis met één tik, registreren met e-mail (naam, telefoon, toestemming voor marketing), vouchers en akkoord op voorwaarden
- ✅ Vouchers in reeksen, met vervaldatum, gebruikslimiet, eigen limieten en een printvel
- ✅ Betaalde toegang via Mollie of Stripe met pakketten, en een **tijd om te betalen** die de klant zelf instelt (met duidelijke uitleg)
- ✅ **Doorgaan met Facebook** met de eigen Facebook-app van de klant
- ✅ **Notificaties**
  - ✅ Melding zodra het A-record gevalideerd is en het SSL-certificaat geregeld is
  - ✅ Maandrapportage aan het begin van elke maand: gasten, apparaten, registraties, vouchers, betalingen, omzet en piekmomenten
- ✅ **Mail-template ontwerper**, visueel en in HTML, voor elke e-mail, per klant en platformbreed
- ✅ Gastenlijst met naam, e-mail, manier van inloggen, CSV-export en verwijderen

## Stap 4: Klanten factureren (v0.4) ✅

- ✅ Plannen en een abonnement per klant (tenant) voor hun portaal, ingesteld door de platformbeheerder: plan, prijs, maandelijks/per kwartaal/jaarlijks en startdatum; automatisch vooraf gefactureerd
- ✅ Facturen vanuit het hoofdbeheerpaneel, met factuurnummers zonder gaten, btw (of btw verlegd), je bedrijfsgegevens en logo, als pdf en per e-mail; ook eenmalige facturen
- ✅ Facturen online betalen via het eigen Mollie- of Stripe-account van het platform, met automatische betaalstatus (webhooks plus een controle op de achtergrond)
- ✅ Overzicht van openstaande, betaalde en te late facturen, terugkerende omzet per maand, automatische herinneringen en overboekingen als betaald markeren
- ✅ Optioneel: het gastportaal van een klant automatisch pauzeren als een factuur onbetaald blijft, en weer hervatten na betaling
- ✅ Klanten zien, downloaden en betalen hun eigen facturen in hun omgeving
- ✅ Klanten zetten betaalde gasttoegang nog steeds zelf aan of uit (stap 3)

## Stap 5: Backups en handleidingen (v0.5) 🚧

- ✅ Volledige en incrementele back-ups (database per tabel en datamap per bestand), versleuteld met AES-256-GCM
- ✅ Remote backuplocaties: SCP (SSH-sleutel of wachtwoord, controle van de hostsleutel), FTPS (expliciet/impliciet, TLS 1.2+) en FTP, plus een lokale map
- ✅ Herstellen vanaf de remote locatie, vanuit de webinterface, met een veiligheidskopie en automatische rollback
- ✅ Back-upschema en bewaartermijn per locatie, e-mail als een back-up mislukt
- ✅ Handleiding voor back-ups, herstel en calamiteitenherstel
- 📋 Complete handleidingen voor klanten en beheerders

## Stap 6: Volledige API 📋

- 📋 Complete REST API voor elke klant (tenant): consoles, hostnamen, portalen, gasten, betalingen en rapportages
- 📋 Platform-API voor het hoofdbeheerportaal: klanten en hun gebruikers aanmaken, wijzigen, opschorten en verwijderen
- 📋 API-sleutels per klant en voor het platform, met rechten (lezen/schrijven) en vervaldatum, aan te maken en in te trekken in de interface
- 📋 OpenAPI-documentatie met interactieve verkenner (NL/EN)
- 📋 Webhooks voor gebeurtenissen zoals gast geautoriseerd, betaling ontvangen en certificaat uitgegeven
- 📋 Rate limiting en een audit trail per API-sleutel

## Later

- 📋 Entra SSO per klant (klanten loggen in met hun eigen Microsoft-tenant)
- 📋 Tweestapsverificatie (TOTP) voor wachtwoordaccounts
- 📋 Extra talen voor beheeromgeving en gastportals (bijv. Duits en Frans)
