# Changelog

[English](CHANGELOG.md) · **Nederlands**

Alle noemenswaardige wijzigingen per versie. Versies volgen [Semantic Versioning](https://semver.org/lang/nl/); testversies hebben een achtervoegsel zoals `-beta.1`.

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
