# Changelog

[English](CHANGELOG.md) · **Nederlands**

Alle noemenswaardige wijzigingen per versie. Versies volgen [Semantic Versioning](https://semver.org/lang/nl/); testversies hebben een achtervoegsel zoals `-beta.1`.

## [0.7.0-beta.2] - 2026-10-21 (testkanaal)

Stap 7, deel 2: meer manieren voor gasten om in te loggen.

- **Sms-verificatie**: gasten typen een mobiel nummer en de code van zes cijfers uit de sms. Verstuurd met het eigen **Twilio**- of **MessageBird**-account van de klant; standaard landcode voor nummers als `06 12345678`, een knop voor een testbericht en het aantal sms'jes deze maand. Codes zijn 10 minuten geldig met 5 pogingen; maximaal 3 codes per gast, 5 per nummer per uur en een dagmaximum per klant.
- **Inloggen met Google, Apple en Microsoft**, elk met een eigen app van de klant (Google OAuth-client, Microsoft Entra-app-registratie, Apple Services ID met een `.p8`-sleutel), met het redirect-adres om te kopiëren, stap-voor-stap-uitleg en een knop **Koppeling testen**. Op het gastportaal delen alle sociale logins één tabblad **Account** met een knop per provider. De korte toegang om in te loggen en de walled-garden-domeinen gelden nu voor alle providers.
- **Hotellogin**: gasten loggen in met kamernummer en achternaam en blijven online tot vertrek, met een maximum aantal apparaten per kamer en een blokkade na 5 verkeerde achternamen. Nieuwe pagina **Hotel** met verblijven in huis, verwacht en alle, handmatig toevoegen en wijzigen, **CSV-import** uit elk PMS, de API (`/api/v1/hotel/…`, nieuwe scope `hotel`) en een **PMS-koppeling** met **Apaleo** en **Mews** die elke 10 minuten synchroniseert (en meteen als de kamer van een gast nog niet bekend is).
- Live dashboard, gastenlijst en rapportages kennen de nieuwe manieren van inloggen.
- Opgelost: een deel van de instellingen wijzigen via de API (of een instellingenkaart) zet de overige velden van die groep niet meer terug naar de standaardwaarden.
- Nieuwe handleidingen: [Sms en sociale login](docs/nl/sms-en-sociale-login.md) en [Hotellogin](docs/nl/hotellogin.md).

## [0.7.0-beta.1] - 2026-10-21 (testkanaal)

Stap 7, deel 1: beveiliging, monitoring en een live dashboard.

- **Tweestapsverificatie** voor iedereen: zet het aan bij **Mijn account** met elke authenticator-app (QR-code of sleutel), bevestig met een code en bewaar tien eenmalige **herstelcodes** (kopiëren of downloaden; op elk moment een nieuwe set). Na het wachtwoord wordt om een code gevraagd; een code werkt maar één keer, en te veel verkeerde codes zetten het account 15 minuten op pauze. Ook na een wachtwoordreset is de code nodig.
- **Verplichte 2FA**: de platformbeheerder maakt het verplicht op de nieuwe pagina **Systeem → Beveiliging** voor platformbeheerders en/of klanten (beheerders of iedereen); klantbeheerders kunnen het voor hun eigen team verplichten op de pagina **Team**. Wie het moet gebruiken, krijgt direct na het inloggen het instelscherm. Inloggen met Microsoft (Entra) telt standaard als tweestapsverificatie (instelbaar). Beheerders kunnen de 2FA van een gebruiker **resetten** als telefoon en codes kwijt zijn; gebruikers krijgen een **2FA**-label.
- **Monitoring**: consoles worden nu elke 5 minuten gecontroleerd (was elk uur), inclusief de status van elk access point. Bij **Notificaties → Monitoring** kiezen klanten e-mails voor *console offline* en *access point offline* en na hoeveel minuten (standaard 10); als alles weer werkt volgt een tweede e-mail met de duur. Nieuwe e-mailtemplates en webhooks `device.offline` / `device.online`.
- **Live dashboard** (nieuwe pagina **Inzicht → Live**): gasten online per locatie en per access point, verbindingen en unieke apparaten vandaag tegenover dezelfde dag vorige week, het afgelopen uur, vandaag per uur met vorige week ter vergelijking, manieren van inloggen, de laatste aanmeldingen en de status van consoles en access points, elke 10 seconden ververst. Ook in de API als `GET /api/v1/live`.
- API: beleid voor tweestapsverificatie (`/security-settings`), de 2FA van een gebruiker resetten en de live cijfers.
- Nieuwe handleiding: [Beveiliging en tweestapsverificatie](docs/nl/beveiliging.md); monitoring en het live dashboard staan in [Notificaties](docs/nl/notificaties-mail.md).

## [0.6.0-beta.1] - 2026-10-21 (testkanaal)

Stap 6: volledige API.

- **REST API** op `/api/v1` met API-sleutels (`Authorization: Bearer cpk_…`). Hij gebruikt dezelfde routes en controles als de webinterface, zodat alles gelijk blijft.
  - **Klant-API**: consoles, hostnames, portalinstellingen en ontwerp, afbeeldingen, Facebook-login, gasten (ook verwijderen volgens de AVG), vouchers, betaalinstellingen en pakketten, betalingen, meldingen en gastmailtemplates, overzicht en maandrapport, teamleden en facturen (ook als pdf).
  - **Platform-API**: klanten (aanmaken met een eerste beheerder, wijzigen, opschorten, verwijderen), gebruikers, serverinstellingen (SMTP, SSO, systeem, hosting, facturatie-instellingen), e-mailtemplates van het platform, facturatie (plannen, abonnementen, facturen), back-ups (locaties, nu uitvoeren; terugzetten blijft in de webinterface) en updates.
- **API-sleutels** onder het nieuwe menu-item **API** (klantbeheerders) en **Systeem → API** (platformbeheerder): lees/schrijfrechten per onderdeel, vervaldatum (30/90/365 dagen, een datum of nooit), verzoeken per minuut, bewerken, intrekken en verwijderen. De sleutel wordt één keer getoond en als SHA-256-hash opgeslagen; sleutels werken niet meer als hun klant is opgeschort.
- **Rate limiting** per sleutel per minuut met `X-RateLimit-*`-headers en `429`, plus een limiet op mislukte sleutelpogingen per adres.
- **Audit trail per sleutel**: elk verzoek (methode, pad, status, duur, IP) 90 dagen, en wijzigingen via de API worden gelogd met de sleutel erbij.
- **Webhooks**: ondertekende (HMAC-SHA256 over tijdstempel en body) berichten voor `guest.authorized`, `payment.paid`, `hostname.active`, `console.offline`/`console.online` en `invoice.issued`/`invoice.paid` (klanten) en `tenant.created`/`updated`/`deleted`, facturen en `backup.succeeded`/`failed` (platform). Herhaalpogingen van 1 min tot 24 uur, uitgezet na 50 fouten op rij, afleverlogboek met antwoorden, **Testen**, **Opnieuw sturen**, geheim tonen en vervangen. Webhooks van klanten roepen alleen openbare `https://`-adressen aan (opnieuw gecontroleerd bij het verbinden, zodat DNS ze niet naar het interne netwerk kan sturen).
- **Documentatie**: OpenAPI 3.1 in het Nederlands en Engels met een verkenner in de interface (zoeken, parameters, voorbeeld-bodies, uitproberen met een sleutel, cURL), te downloaden en openbaar op `/api/v1/openapi.json`.
- Nieuwe handleiding: [API en webhooks](docs/nl/api.md).
- Roadmap: nieuwe stap 7 met ideeën voor gastbeleving, marketing en groei.

## [0.5.0-beta.1] - 2026-10-21 (testkanaal)

Stap 5: back-ups en herstel.

- **Back-ups** (nieuw menu-item onder Systeem voor de platformbeheerder): de complete database en de datamap, inclusief `APP_SECRET`, zodat een back-up ook op een nieuwe server terug te zetten is.
- **Volledig en incrementeel**: een incrementele back-up verstuurt alleen de databasetabellen en bestanden die sinds de vorige back-up veranderd zijn; terugzetten geeft de complete stand van dat moment.
- **Locaties**: SCP via SSH (met de eigen ed25519-sleutel van deze server of een wachtwoord, hostsleutel onthouden en gecontroleerd), FTPS (expliciet of impliciet TLS, minimaal TLS 1.2, certificaatcontrole), FTP en een lokale map. Knop Verbinding testen die een testbestand schrijft en terugleest.
- **Versleuteling** met AES-256-GCM en een sleutel afgeleid (scrypt) van je wachtwoord; bij herstel wordt elk deel gecontroleerd met SHA-256.
- **Schema en bewaren per locatie**: volledig elke dag/week/maand op een vast uur, tussendoor incrementeel elke 1/6/12/24 uur, de nieuwste *n* volledige back-ups bewaren. Mislukte back-ups worden na 30 minuten opnieuw geprobeerd en gemaild naar de platformbeheerders (nieuw template *Back-up mislukt*). Geschiedenis van de laatste 50 back-ups.
- **Herstellen** vanaf de remote locatie in de webinterface: eerst wachtwoord en versie gecontroleerd, alles gedownload en geverifieerd, daarna stopt de systeemservice de app, bewaart de huidige stand, vervangt de database in één transactie, zet de datamap en `APP_SECRET` terug en start weer, met automatische rollback als de app niet opkomt.
- Nieuwe handleiding: [Back-ups en herstel](docs/nl/backups.md).

## [0.4.0-beta.1] - 2026-10-21 (testkanaal)

Stap 4: klanten factureren vanuit het hoofdbeheerpaneel.

- **Facturatie** (nieuw menu-item voor de platformbeheerder) met vier tabbladen: facturen, abonnementen, plannen en instellingen.
- **Plannen en abonnementen**: herbruikbare plannen (prijs excl. btw, maandelijks/per kwartaal/jaarlijks) en per klant een factuurprofiel met factuuradres, factuur-e-mail, btw-nummer, referentie, taal, btw-tarief of btw verlegd, en het abonnement (plan, eigen prijs, periode, startdatum, volgende factuurdatum).
- **Facturen**: abonnementsfacturen worden automatisch vooraf gemaakt voor elke periode (elk uur, haalt in na een storing); eenmalige facturen maak je zelf. Concepten zijn te bewerken; bij uitgeven krijgt de factuur een nummer zonder gaten (voorvoegsel met `{year}`, instelbaar aantal cijfers), factuur- en vervaldatum, en worden je bedrijfs- en klantgegevens vastgelegd. Annuleren in plaats van verwijderen; facturen blijven bewaard als een klant wordt verwijderd.
- **PDF en e-mail**: A4-factuur in het Nederlands of Engels met je logo (PNG, JPG of SVG), bedrijfsgegevens, regels, btw, betaalinstructies en voettekst; gemaild met de pdf als bijlage. Nieuwe e-mailtemplates *Factuur*, *Betalingsherinnering* en *Betaling ontvangen*.
- **Online betalen** via het eigen Mollie- of Stripe-account van het platform: een openbare betaalpagina per factuur (link in de e-mail en in de klantomgeving), webhooks plus een controle elke minuut, automatische bevestiging.
- **Te late facturen**: automatische herinneringen (bijvoorbeeld 7 en 14 dagen na de vervaldatum), overboekingen als betaald markeren, en optioneel het gastportaal van de klant pauzeren na een aantal dagen te laat. De klant kan nog wel inloggen en betalen; het portaal gaat vanzelf weer aan, of met de hand met **Portaal hervatten**.
- **Klantomgeving**: nieuwe pagina **Facturen** voor klantbeheerders met wat er openstaat, het abonnement, alle facturen met pdf en een knop Betalen, en een melding op het dashboard zolang het portaal gepauzeerd is.
- Klantenpagina: snelkoppeling naar de facturatie en het abonnement van een klant.
- Nieuwe handleiding: [Klanten factureren](docs/nl/facturatie.md).

## [0.3.0-beta.2] - 2026-10-20 (testkanaal)

- Nieuwe klant: vul optioneel meteen de eerste beheerder in (naam en e-mailadres). Die krijgt direct de uitnodigingsmail en logt in op hetzelfde adres als het beheerpaneel. Kan de e-mail niet worden verstuurd, dan zie je waarom.

## [0.3.0-beta.1] - 2026-10-20 (testkanaal)

Stap 3: editor, registratie, betaling en notificaties.

- **Portal-editor**: drag-and-drop paginabouwer met blokken voor logo, icoon, kop, tekst, afbeelding, linkknop, scheidingslijn en ruimte, zes templates, kleuren, achtergrond, lettertypen en kaartstijl, teksten per taal, voorbeeld op telefoon en desktop. De editor en de gastpagina gebruiken dezelfde opmaak.
- **Toegang & inloggen** (vervangt *Portalinstellingen*): gratis, registreren met e-mail (naam en telefoon uit/optioneel/verplicht, toestemming voor marketing, welkomstmail), vouchers, betaling en Facebook, als tabbladen op de gastpagina; de talen die het portaal aanbiedt.
- **Vouchers**: reeksen met tijd, gebruikslimiet, vervaldatum en eigen limieten; goed leesbare codes; intrekken, verwijderen en een printvel.
- **Betalingen** via Mollie of Stripe met het eigen account van de klant: pakketten, transacties met totalen, webhooks plus een controle op de achtergrond, betaalbewijs per e-mail, en een instelbare **tijd om te betalen** (0–30 minuten) met uitleg op het scherm.
- **Doorgaan met Facebook**: gasten loggen in met Facebook via de eigen Facebook-app van de klant, met een instelbare tijd om in te loggen.
- **Notificaties**: e-mail als een hostnaam live is (A-record gevalideerd en SSL geregeld) en een maandrapportage, naar beheerders en/of eigen adressen, met logboek en automatisch opnieuw proberen.
- **Rapportages**: maandcijfers met vergelijking, gasten per dag, uur, manier van inloggen en site.
- **Mail-template ontwerper**: elke e-mail visueel of in HTML, per taal; klanten voor hun gast- en notificatiemails, de platformbeheerder voor alle e-mails.
- **Gasten**: naam, e-mail, manier van inloggen, voucher of pakket, CSV-export en verwijderen.
- Roadmap: nieuwe stap 4, klanten factureren vanuit het hoofdbeheerpaneel; backups schuiven naar stap 5 en de API naar stap 6.
- Nieuwe handleidingen: portal-editor; gasttoegang (vouchers, betalingen, Facebook, pre-autorisatie); notificaties, rapportages en e-mailtemplates.

## [0.2.1-beta.1] - 2026-10-20 (testkanaal)

- Het beheerpaneel van het platform beheert nu alleen klanten en de server: klanten, gebruikers, e-mail, SSO en Hosting & SSL. UniFi-consoles, portalinstellingen, hostnamen en gasten staan alleen in de eigen omgeving van de klant, en de API weigert ze voor platformbeheerders. De klantkiezer op die pagina's is weg.
- Dashboard voor de platformbeheerder: de stap "Koppel een UniFi-console" is vervangen door "Nodig de beheerder van een klant uit".
- Het menu toont de platform-API (stap 5) als binnenkort beschikbaar.

## [0.2.0] - 2026-10-20

Stabiele release van stap 2, gelijk aan 0.2.0-beta.2.

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
