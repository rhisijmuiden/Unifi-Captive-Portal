# Hotellogin: kamernummer en achternaam

[English](../en/hotel-login.md) · **Nederlands**

Hotelgasten loggen in met hun **kamernummer** en **achternaam** en blijven online tot **vertrek**. Zet **Kamernummer en achternaam** aan bij **Captive portals → Toegang & inloggen** en beheer de verblijven op de nieuwe pagina **Hotel**.

## Hoe gasten inloggen

- Het kamernummer wordt vergeleken zonder spaties en voorloopnullen (`012` = `12`).
- De achternaam wordt vergeleken zonder hoofdletters, accenten, spaties of leestekens, en het laatste deel is genoeg: `Berg` vindt *van den Berg*, `Muller` en `Mueller` vinden *Müller*.
- Gasten kunnen inloggen vanaf middernacht op de aankomstdag tot het vertrekmoment; de toegang stopt bij vertrek.
- **Apparaten per kamer** (standaard 5) bepaalt hoeveel apparaten tegelijk online mogen op één verblijf.
- Na **5 verkeerde achternamen** voor een kamer is die kamer 15 minuten geblokkeerd, zodat namen niet te raden zijn.

## Waar de verblijven vandaan komen

**Handmatig**: **Verblijf toevoegen** met kamer, achternaam, aankomst en vertrek (datum en tijd; standaard de **uitchecktijd**, 12:00).

**CSV-import**: exporteer de in-house-lijst uit je PMS en importeer die bij **CSV importeren** (of plak de inhoud). Kolommen: kamer, achternaam, aankomst, vertrek. Met een kopregel (bijvoorbeeld `Kamer;Achternaam;Aankomst;Vertrek` of `Room;Surname;Arrival;Departure`) mag de volgorde anders zijn. Scheidingsteken `;`, `,` of tab; datums als `2026-10-21`, `21-10-2026` of met een tijd. **Bestaande lijst vervangen** verwijdert eerst alle handmatige en geïmporteerde verblijven.

**API**: `POST /api/v1/hotel/stays` voor één verblijf, of `POST /api/v1/hotel/stays/import` met `{"stays":[…], "replace": false}`. Verblijven met een `externalId` worden bijgewerkt als je ze opnieuw stuurt. De sleutel heeft de scope `hotel:write` nodig.

**PMS-koppeling** (elke 10 minuten bijgewerkt, en meteen als de kamer van een gast niet gevonden wordt):

- **Apaleo**: maak in Apaleo een eigen app met *client credentials* en de scope `reservations.read`, en vul de client-ID, het geheim en de **property-ID** in (bv. `AMS`). Bevestigde en in-house reserveringen met een toegewezen kamer worden opgehaald.
- **Mews**: vraag Mews om een **Connector API**-integratie en vul de client token en access token in (en het platformadres voor de demo-omgeving). Gestarte en bevestigde reserveringen met een toegewezen kamer worden opgehaald, met de kamernaam en de achternaam van de gast.

Verblijven uit het PMS kun je op het platform niet wijzigen; doe dat in het PMS. **Koppeling testen** haalt de reserveringen op zonder ze op te slaan, **Nu ophalen** haalt ze op en slaat ze op.

Een verblijf verwijderen verbreekt geen apparaten die al online zijn. Verblijven worden een week na vertrek automatisch verwijderd.

Let op: de koppelingen met Apaleo en Mews zijn gebouwd op de openbare API-documentatie; probeer ze eerst met een testhotel voordat je ze live gebruikt.

Designed by [RHIS](https://rhis.nl).
