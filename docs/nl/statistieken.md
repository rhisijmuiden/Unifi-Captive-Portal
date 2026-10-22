# Platformstatistieken

[English](../en/statistics.md) · **Nederlands**

Als platformbeheerder zie je onder **Statistieken** (menu links, direct onder Overzicht) hoe het hele platform wordt gebruikt: hoeveel gasten er inlogden, via welke resellers en klanten, op welke momenten van de dag, en hoe dat verandert in de tijd. Elke weergave download je als CSV-bestand of als pdf-rapport.

De pagina toont alleen **cijfers**. Je kunt hier geen consoles, portalen of gasten van een klant openen of wijzigen; dat blijft in de eigen omgeving van de klant. Resellers en klanten zien deze pagina niet; klanten hebben hun eigen pagina **Rapportages** met hun maandrapport.

## Filters

Alle filters staan in één balk bovenaan en worden in het adres bewaard, zodat je een weergave als bladwijzer kunt opslaan of kunt delen.

| Filter | Wat het doet |
|---|---|
| **Periode** | 7 dagen, 30 dagen (standaard), 90 dagen, 12 maanden, dit jaar, of **Aangepast** met een eigen begin- en einddatum (maximaal drie jaar). |
| **Reseller** | Alle resellers, alleen **directe klanten** (klanten zonder reseller), of één reseller. |
| **Klant** | Eén klant. De lijst toont alleen de klanten van de gekozen reseller. |
| **Staven per** | Dag, week of maand. **Auto** kiest dagen tot twee maanden, weken tot een half jaar en daarna maanden. |

Klik je op een reseller bij **Per reseller** of op een klant bij **Per klant**, dan wordt dat filter gezet. **Filters wissen** brengt je terug naar de laatste 30 dagen van alle klanten.

## Wat je ziet

| Onderdeel | Betekenis |
|---|---|
| **Gastaanmeldingen** | Elke geslaagde aanmelding van een gast op een portaal in de periode. Een gast die twee keer inlogt, telt twee keer. |
| **Unieke apparaten** | Verschillende apparaten (MAC-adres per klant) die zich aanmeldden. |
| **Actieve klanten** | Klanten met minstens één gastaanmelding in de periode, van alle klanten in de selectie. |
| **Gasten nu online** | Gasten van wie de toegang nog niet is afgelopen, op dit moment en los van de periode. |
| **Registraties** | Verschillende e-mailadressen die zich registreerden via inloggen met e-mail. |
| **Nieuwe apparaten / terugkerend** | Apparaten die in deze periode voor het eerst inlogden, en apparaten die al eerder gezien waren. |
| **Nieuwe klanten** | Klanten die in de periode zijn aangemaakt. |
| **Beheerders ingelogd** | Beheerders (platform, reseller en klant) die in de periode inlogden op het beheerpaneel. |
| **Vouchers gebruikt / betaalde aanmeldingen / betalingen van gasten** | Aanmeldingen met een voucher of betaling, en het bedrag dat gasten via Mollie of Stripe aan klanten betaalden. Dit is niet je eigen facturatie; die staat onder **Facturatie**. |

Bij elk hoofdcijfer zie je het verschil met de **vorige periode**: hetzelfde aantal dagen direct vóór de gekozen periode.

- **Verloop**: een lijn van gastaanmeldingen (of unieke apparaten, of actieve klanten) per dag, week of maand, met de vorige periode als stippellijn. Beweeg over de grafiek voor de precieze aantallen.
- **Drukke momenten**: een heatmap van aanmeldingen per weekdag en uur, met de totalen per uur erboven en per weekdag rechts. Hoe donkerder het vakje, hoe drukker. Het drukste uur staat boven de grafiek. Tijden zijn in de tijdzone van de server (Europe/Amsterdam, tenzij `TZ` anders is ingesteld).
- **Per reseller**: het aandeel van elke reseller (en van je directe klanten) in de aanmeldingen, hoeveel van hun klanten actief waren, en het verschil met de vorige periode.
- **Inlogmethodes**: hoe gasten inlogden (gratis, e-mail, voucher, betaling, sms, hotelkamer, sociale logins).
- **Per klant**: een tabel met elke klant, sorteerbaar op elke kolom en doorzoekbaar, met gasten, apparaten, registraties, verschil en de laatste aanmelding.

## Exporteren

- **CSV**: alle cijfers van de huidige weergave (samenvatting, het verloop, het raster weekdag × uur, per reseller, per klant en per inlogmethode) in één bestand, de onderdelen onder elkaar. In het Nederlands gebruikt het bestand puntkomma's, zodat Excel het meteen in kolommen opent.
- **Pdf-rapport**: een A4-rapport in de taal van de interface met de hoofdcijfers, een staafgrafiek van het verloop, de heatmap en de tabellen. Handig om naar het management of een reseller te sturen.

Beide downloads volgen de filters die je hebt ingesteld.

## Via de API

Met een platform-API-sleutel met de rechten **Platformstatistieken** (`statistics:read`) haal je dezelfde cijfers op:

- `GET /api/v1/platform/stats?from=2026-10-01&to=2026-10-31&reseller=<id of direct>&tenant=<id>&granularity=day|week|month`
- `GET /api/v1/platform/stats/export?format=csv|pdf&lang=en|nl` met dezelfde filters

Zie [API en webhooks](api.md).
