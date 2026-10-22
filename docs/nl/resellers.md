# White-label resellers

[English](../en/resellers.md) · **Nederlands**

Een reseller is een partner die het captive-portalplatform onder zijn eigen merk aan zijn eigen klanten verkoopt. De reseller beheert die klanten zelf, in een beheerpaneel met zijn eigen logo, kleur en (als je wilt) een eigen adres. Jij als platformbeheerder bepaalt per reseller hoeveel klanten hij mag hebben en welke RHIS-vermeldingen zichtbaar blijven.

## Wie doet wat

| | Platformbeheerder | Reseller-beheerder | Klant (van een reseller) |
|---|---|---|---|
| Resellers aanmaken, wijzigen en opschorten | ✅ | | |
| RHIS-vermeldingen, klantlimiet, beheeradres | ✅ | | |
| Logo, kleur, merknaam, website, support-e-mail | ✅ | ✅ | |
| Eigen klanten aanmaken, wijzigen, opschorten en verwijderen | ✅ | ✅ | |
| Collega's en de eerste beheerder van klanten uitnodigen | ✅ | ✅ | |
| Consoles, portaal, gasten, vouchers enzovoort | | | ✅ |
| Serverinstellingen, SMTP, back-ups, updates, facturatie | ✅ | | |

Net als de platformbeheerder beheert een reseller alleen klanten. Hij ziet hun consoles, portalen en gasten niet: die blijven in de eigen omgeving van de klant.

## Een reseller toevoegen

1. Ga naar **Beheer → Resellers** en klik op **Nieuwe reseller**.
2. Vul de bedrijfsnaam in; de korte naam en de merknaam worden automatisch ingevuld.
3. Optioneel:
   - **Maximaal aantal klanten**: leeg laten voor onbeperkt. Is de limiet bereikt, dan ziet de reseller *Je hebt je limiet bereikt* en vraagt hij jou om die te verhogen.
   - **Eigen beheeradres**, bijvoorbeeld `wifi.partner.nl` (zie hieronder).
   - **Huisstijl**: logo voor lichte achtergronden, logo voor het donkere menu, accentkleur, website en support-e-mail. De reseller kan dit later zelf aanpassen onder **Huisstijl**.
4. Kies onder **RHIS-vermeldingen** wat zichtbaar blijft:
   - **Toon "Powered by RHIS"** (standaard aan): de kaart onderaan het menu en de regel onder **Info**.
   - **Toon "Designed by RHIS"** (standaard uit): rechtsonder in het beheerpaneel, in de voettekst van de gastportalen van de klanten en in hun e-mails.
5. Vul onder **Eerste beheerder** een naam en e-mailadres in en kies **Zelf wachtwoord laten instellen** (uitnodiging per e-mail) of **Inloggegevens genereren** (één keer getoond, met een kant-en-klaar bericht voor WhatsApp; zie [inloggegevens](beveiliging.md#inloggegevens-voor-nieuwe-gebruikers)). Die persoon kan daarna collega's uitnodigen onder **Team**.

## Het beheerpaneel van de reseller

Na het inloggen ziet de reseller zijn eigen merk en een kort menu:

- **Overzicht**: aantal klanten, gebruikers, gasten vandaag en consoles van zijn eigen klanten, en hun recente activiteit.
- **Klanten**: klanten aanmaken (met een eerste beheerder), wijzigen, opschorten of verwijderen. Met een limiet staat er bijvoorbeeld *3 van 10 klanten*.
- **Team**: zijn eigen collega's (rol *Reseller-beheerder*) en, door een klant te kiezen, het team van die klant.
- **Huisstijl**: naam, logo's, accentkleur, website en support-e-mail, met een voorbeeld.

De klanten van de reseller zien hetzelfde merk in hun beheerpaneel: het logo in het menu, de accentkleur op knoppen en links, de merknaam in de browsertab en het support-e-mailadres onder **Info** en op de inlogpagina. Uitnodigingen en wachtwoordmails linken naar het eigen adres van de reseller als hij dat heeft.

## Eigen beheeradres

Met een eigen adres loggen de reseller en zijn klanten in op bijvoorbeeld `https://wifi.partner.nl` en zien ze ook vóór het inloggen al het merk van de reseller.

1. Laat de reseller een DNS-record aanmaken: een **A**-record (en **AAAA** voor IPv6) voor `wifi.partner.nl` naar het publieke IP-adres van deze server. Een **CNAME** naar het eigen adres van het platform werkt ook.
2. Vul het adres bij de reseller in onder **Eigen beheeradres**.
3. Open het adres. Caddy vraagt bij het eerste bezoek automatisch een Let's Encrypt-certificaat aan.

Het adres kan niet ook als portaalhostnaam van een klant of als eigen adres van het platform gebruikt worden.

**Microsoft (Entra) SSO** logt in via het eigen adres van het platform, omdat dat het terugkeeradres is dat in Entra geregistreerd staat. Op het adres van een reseller gaat de knop **Inloggen met Microsoft** daarom verder op het platformadres; na het inloggen wordt het merk van de reseller gewoon getoond.

## Een bestaande klant toewijzen

Open **Beheer → Klanten**, bewerk de klant en kies onder **Reseller** de reseller. Met **Geen (rechtstreeks bij RHIS)** komt de klant weer bij jou. Alleen de platformbeheerder kan klanten tussen resellers verplaatsen.

## Opschorten en verwijderen

- **Opgeschort** sluit het beheerpaneel meteen voor het team van de reseller en voor al zijn klanten (open sessies stoppen, inloggen toont *Dit account is opgeschort*, API-sleutels van die klanten werken niet meer). Gastportalen en wifi-toegang blijven werken.
- Een reseller **verwijderen** kan pas als hij geen klanten meer heeft (verplaats of verwijder ze eerst). Zijn team wordt mee verwijderd.

## API

De platform-API heeft een scope **resellers** (`GET/POST/PUT/DELETE /api/v1/resellers`), met dezelfde velden als het formulier, waaronder `showPoweredBy`, `showDesignedBy`, `maxTenants` en een optionele `admin` om uit te nodigen. Met `resellerId` op `POST/PUT /api/v1/tenants` wijs je een klant aan een reseller toe. Zie [API en webhooks](api.md).
