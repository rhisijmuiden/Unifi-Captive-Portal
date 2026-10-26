# Roadmap

[English](ROADMAP.md) · **Nederlands**

Laatst bijgewerkt: 22 oktober 2026. Deze roadmap wordt na elke grote build bijgewerkt.

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

## Stap 6: Volledige API (v0.6) ✅

- ✅ Complete REST API voor elke klant (tenant) op `/api/v1`: consoles, hostnamen, portalinstellingen en ontwerp, gasten, vouchers, betalingen en pakketten, meldingen en gastmails, rapportages, teamleden en facturen
- ✅ Platform-API voor het hoofdbeheerportaal: klanten aanmaken (met een eerste beheerder), wijzigen, opschorten en verwijderen, gebruikers, serverinstellingen, e-mailtemplates van het platform, facturatie, back-ups en updates
- ✅ API-sleutels per klant en voor het platform, met lees/schrijfrechten per onderdeel, vervaldatum en rate limit, aan te maken, te wijzigen, in te trekken en te verwijderen in de interface; de sleutel wordt één keer getoond en gehasht opgeslagen
- ✅ OpenAPI 3.1-documentatie in het Nederlands en Engels met een interactieve verkenner in de interface, en `/api/v1/openapi.json` voor andere tools
- ✅ Ondertekende webhooks (HMAC-SHA256) voor gast geautoriseerd, betaling ontvangen, hostname live, console offline/online, facturen, klanten en back-ups, met herhaalpogingen, afleverlogboek, testknop en nieuw geheim
- ✅ Rate limiting en een audit trail per API-sleutel (elk verzoek 90 dagen, plus de wijzigingen die hij deed)

## Stap 7: Gastbeleving, marketing en groei (v0.7) ✅

- ✅ **SMS-verificatie** voor gasten met het eigen Twilio- of MessageBird-account van de klant, met limieten per gast, nummer en dag
- ✅ **Google-, Apple- en Microsoft-login** voor gasten, elk met een eigen app van de klant, samen met Facebook in één tabblad
- ✅ **Marketing en AVG**: opt-in voor de nieuwsbrief, export naar Mailchimp en HubSpot (en CSV), een bewaartermijn, en verwijderverzoeken van gasten met bevestiging per e-mail
- ✅ **Live dashboard** per klant: gasten online per locatie en access point, vandaag per uur tegenover vorige week, manieren van inloggen en de laatste aanmeldingen (dataverbruik per access point volgt zodra de UniFi-API dat biedt)
- ✅ **Enquête na het inloggen** met sterren en een opmerking, gevolgd door een knop voor een Google-review
- ✅ **Advertenties of een splash-video** vóór of na toegang, met weergaven, klikken en planning
- ✅ **White-label voor resellers**: partners die zelf klanten beheren onder hun eigen merk, logo, kleur en beheeradres, met een klantlimiet en de RHIS-vermeldingen per reseller instelbaar
- ✅ **Monitoring**: een e-mail en webhook als een console of access point langer offline is dan de klant instelt, en als hij weer werkt
- ✅ **Tweestapsverificatie (2FA)** voor beheerders en klanten, met herstelcodes en beleid per platform en per klant
- ✅ **Hotel/PMS-koppeling**: gasten loggen in met kamernummer en achternaam tot vertrek; verblijven handmatig, via CSV, API of gesynchroniseerd uit Apaleo en Mews

## Verbeteringen na v0.7 ✅

- ✅ Betere bezorging van mail: EHLO-naam, DKIM-sleutel genereren en een afleverbaarheidscontrole (0.7.2-beta.1)
- ✅ **Inloggegevens genereren** bij het aanmaken van een klant, reseller of gebruiker, één keer getoond met een kant-en-klaar bericht voor WhatsApp, en een eigen wachtwoord kiezen bij de eerste keer inloggen (0.7.2-beta.2)
- ✅ **Platformstatistieken** voor de platformbeheerder: gasten per reseller en klant, verloop tegenover de vorige periode, heatmap weekdag × uur, actieve klanten en apparaten, filters en export als CSV/pdf, ook in de platform-API (0.7.3-beta.1)

## Versie 1.0 ✅

- ✅ **Eerste officiële release (1.0.0, 22 oktober 2026)**: stap 1 tot en met 7 en de verbeteringen hierboven, op zowel het stable- als het testkanaal. Nieuw werk gaat verder als 1.0.x- en 1.x-testversies.
- 🧪 **Eenvoudig wachtwoord resetten (1.0.1-beta.1)**: reset-e-mail of nieuwe inloggegevens voor gebruikers, klanten en resellers, vanuit Gebruikers, Klanten en Resellers.
- 🧪 **UniFi Fabric (1.0.1-beta.2)**: consoles van een UniFi Fabric koppelen met één API-sleutel, meerdere tegelijk, met een melding voor consoles die later bij de Fabric komen.

## Later

- 📋 Entra SSO per klant (klanten loggen in met hun eigen Microsoft-tenant)
- 📋 Extra talen voor beheeromgeving en gastportals (bijv. Duits en Frans)
