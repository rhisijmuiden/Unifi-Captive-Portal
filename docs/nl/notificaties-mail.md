# Notificaties, rapportages en e-mailtemplates

[English](../en/notifications-mail.md) · **Nederlands**

## Notificaties

Bij **Inzicht → Notificaties** kies je welke e-mails het platform je stuurt:

- **Hostnaam is live**: zodra het A-record van je hostnaam gevalideerd is en het SSL-certificaat geregeld is. Eén keer per hostnaam.
- **Maandrapportage**: aan het begin van elke maand het rapport van de vorige maand.

**Wie ze krijgt**: standaard alle klantbeheerders. Zet dat uit en/of voeg eigen adressen toe, zoals een manager of een gedeelde mailbox. Het logboek rechts toont elke notificatie met de status; een notificatie die mislukte (bijvoorbeeld omdat SMTP niet bereikbaar was) wordt automatisch opnieuw geprobeerd.

Notificaties gaan via de SMTP-server van het platform, dus de platformbeheerder moet eerst **E-mail (SMTP)** hebben ingesteld.

## Monitoring: consoles en access points

Het platform controleert elke gekoppelde console elke 5 minuten. Bij **Inzicht → Notificaties → Monitoring** kies je:

- **Console offline**: een e-mail als een UniFi-console niet bereikbaar is (bijvoorbeeld geen internet of geen stroom op die locatie). Gasten daar kunnen dan niet inloggen via het portaal.
- **Access point offline**: een e-mail als UniFi meldt dat een van je access points offline is. Standaard uit.
- **Melden na**: hoe lang een storing moet duren voordat je de e-mail krijgt (5 minuten tot 2 uur, standaard 10). Korte haperingen negeren we.

Als de console of het access point weer werkt, krijg je een tweede e-mail met hoe lang de storing duurde, maar alleen als de eerste is verstuurd. Beide e-mails gaan naar dezelfde ontvangers als de andere notificaties en staan in het logboek. De platformbeheerder past het uiterlijk aan bij **E-mailtemplates** (*Console offline*, *Console weer online*, *Access point offline*, *Access point weer online*). Dezelfde momenten zijn er als webhooks: `console.offline`, `console.online`, `device.offline` en `device.online`.

## Live dashboard

**Inzicht → Live** laat zien wat er nu op je gastennetwerk gebeurt en ververst elke 10 seconden:

- gasten die nu online zijn (per locatie), verbindingen en unieke apparaten vandaag, vergeleken met dezelfde dag vorige week, en het afgelopen uur
- vandaag per uur als staafdiagram, met dezelfde weekdag vorige week als lijn ter vergelijking (ga met de muis over een staaf voor de aantallen)
- hoe gasten vandaag inloggen, en wie er per access point online is
- de laatste aanmeldingen
- de status van elke console en zijn access points, met een rode balk zodra er iets offline is

## Rapportages

**Inzicht → Rapportages** toont een maand in één oogopslag:

- verbonden gasten, unieke apparaten, e-mailregistraties, gebruikte vouchers, betalingen en omzet, steeds vergeleken met de maand ervoor
- gasten per dag en per uur, met de drukste dag en het drukste uur
- gasten per manier van inloggen, het aantal marketing-opt-ins en, bij meer dan één site, gasten per site

Blader met de pijlen door de maanden en verstuur het rapport direct met **Dit rapport naar mij mailen**. Maanden volgen de tijdzone Europe/Amsterdam (in te stellen met `TZ`).

## E-mailtemplates

Elke e-mail die het platform verstuurt, kun je ontwerpen, visueel of in HTML.

- **Klanten** (bij **Inzicht → Gast-e-mails**) ontwerpen de e-mails die hun gasten en beheerders krijgen: *Welkom voor gasten*, *Betaalbewijs*, *Hostnaam is live* en *Maandrapportage*.
- **De platformbeheerder** (bij **Systeem → E-mailtemplates**) ontwerpt de platformbrede versies van alle e-mails, ook uitnodigingen, wachtwoordherstel en de SMTP-test. Klanten zonder eigen versie krijgen deze.

Volgorde: de eigen versie van de klant → de versie van het platform → de ingebouwde standaard. **Terug naar standaard** verwijdert je eigen versie.

### Bewerken

- Kies bovenaan de taal; elke taal heeft een eigen versie.
- **Visueel**: bouw de e-mail op uit blokken (kop, tekst, knop, afbeelding, scheidingslijn, ruimte en, bij rapportages, het gegevensblok) en stel kleuren, logo, lettertype en afgeronde hoeken in.
- **HTML**: schrijf je eigen HTML. **Vullen met het visuele ontwerp** zet de visuele versie als startpunt om naar HTML.
- **Invulvelden**: klik erop om te kopiëren en plak het in een tekst, bijvoorbeeld `{{name}}`. In HTML wordt `{{name}}` altijd veilig gemaakt (escaped); `{{{data}}}` voegt de kant-en-klare tabel van een rapport in.
- Het voorbeeld rechts gebruikt voorbeeldgegevens; **Test naar mij sturen** stuurt hem naar je eigen adres.

Elke e-mail eindigt met "Designed by RHIS"; in HTML-modus wordt dat toegevoegd als het ontbreekt.

Designed by [RHIS](https://rhis.nl).
