# Nieuwsbrief, AVG, feedback en advertenties

[English](../en/marketing-feedback-ads.md) · **Nederlands**

Drie pagina's onder **Marketing** in de eigen omgeving van de klant halen meer uit de gastenwifi: nieuwsbriefabonnees verzamelen met toestemming, verwijderverzoeken afhandelen, gasten om een beoordeling en Google-review vragen, en een afbeelding of splashvideo tonen.

## Nieuwsbrief & AVG

### Abonnees verzamelen

1. Zet onder **Captive portals → Toegang & inloggen** **E-mail** aan (en/of Google, Apple, Microsoft of Facebook) en bij **Registreren met e-mail** **Toestemming vragen voor nieuws en aanbiedingen**.
2. Gasten zien nu een leeg vinkje *Ik wil af en toe nieuws en aanbiedingen ontvangen* op het e-mailformulier en het tabblad **Account**. Alleen gasten die het zelf aanvinken tellen als opt-in.
3. Elke gast die met een e-mailadres inlogt (e-mail, Google, Apple, Microsoft, Facebook, betaling) staat op **Marketing → Nieuwsbrief & AVG** met naam, bezoeken en laatste bezoek. Wie eenmaal opt-in gaf, houdt dat bij latere bezoeken tot de gegevens gewist worden.

**CSV downloaden** exporteert de opt-ins (of alle contacten) voor elk ander mailprogramma. Cellen die met `=`, `+`, `-` of `@` beginnen krijgen een `'` ervoor, zodat spreadsheetprogramma's ze niet als formule uitvoeren.

### Mailchimp

1. Ga in Mailchimp naar **Profile → Extras → API keys** en maak een sleutel. Die eindigt op je datacenter, bijvoorbeeld `…-us21`.
2. De **Audience ID** staat onder **Audience → Settings → Audience name and defaults**.
3. Kies **Mailchimp** bij **Koppeling nieuwsbrief**, vul beide in en klik **Koppeling testen**; de naam van de audience verschijnt.
4. **Dubbele opt-in** laat Mailchimp eerst zelf een bevestigingsmail sturen (het contact staat op *pending* tot de bevestiging).

Contacten worden toegevoegd of bijgewerkt met voornaam, achternaam, taal en de tag `wifi`.

### HubSpot

1. Ga in HubSpot naar **Settings → Integrations → Private apps** en maak een app met de scopes `crm.objects.contacts.read` en `crm.objects.contacts.write`.
2. Kies **HubSpot**, plak het token en klik **Koppeling testen**.

Contacten worden op e-mailadres aangemaakt of bijgewerkt met voornaam, achternaam en telefoonnummer.

### Versturen

Met **Automatisch versturen** aan gaat een nieuwe of gewijzigde opt-in meteen mee, en wordt wat mislukte elk kwartier opnieuw geprobeerd. **Nu versturen** stuurt alles wat klaarstaat. De kolom **Nieuwsbrief** toont *Opt-in* (wacht), *Verstuurd* of *Fout* (beweeg erover voor de reden).

### Bewaartermijn

**Bewaartermijn zonder opt-in** (standaard *Bewaren*) wist na 30 dagen tot 2 jaar naam, e-mail en telefoon van gasten die **geen** opt-in gaven. De sessies blijven als anonieme statistiek. Contacten met opt-in blijven tot ze zelf om verwijdering vragen.

### Verwijderverzoeken (recht op vergetelheid)

- Elke gastpagina heeft onderaan een **Privacy**-link, naast *Designed by RHIS*. De gast typt een e-mailadres en krijgt een mail met een bevestigingsknop, 48 uur geldig. De pagina zegt altijd *kijk in je mailbox*, zodat niemand kan uitzoeken welke adressen bekend zijn.
- Na bevestigen worden naam, e-mail en telefoon van elk bezoek gewist, het contact verwijderd, en het adres ook **bij Mailchimp** (permanent verwijderen) of **HubSpot** (AVG-verwijdering) weggehaald.
- Je kunt een adres ook zelf wissen met **Alles wissen**. Beide verschijnen in de lijst met verzoeken; het adres zelf wordt niet bewaard, alleen een hash.
- De bevestigingsmail is de template **Verwijderverzoek (gasten)** onder **Inzicht → Gast-e-mails**, per taal aan te passen.
- De privacypagina staat op `https://<je hostname>/portal/privacy` (of `/portal/privacy/<klant-slug>` op het platformadres), zodat je er ook vanuit je eigen privacyverklaring naar kunt linken.

## Feedback: enquête en Google-review

Zet op **Marketing → Feedback** **Enquête tonen** aan. Na het inloggen stelt de pagina *Je bent verbonden* je vraag (per taal, standaard *Hoe was je bezoek?*) met 1 tot 5 sterren en eventueel een opmerking. Antwoorden is nooit verplicht en per bezoek kan één keer geantwoord worden.

Met een **Google-reviewlink** (Google-bedrijfsprofiel → **Reviews vragen** → link kopiëren) krijgt de gast na het antwoord een knop **Review schrijven op Google**. Google staat niet toe dat je alleen tevreden gasten om een review vraagt, dus iedereen ziet de knop; je kunt hem uitzetten en alleen de enquête houden.

De pagina toont het gemiddelde, de verdeling per ster en de laatste opmerkingen over 30, 90 of 365 dagen. Dezelfde cijfers staan in de API (`GET /api/v1/survey`).

## Advertenties en splashvideo

Voeg op **Marketing → Advertenties** een afbeelding toe (PNG, JPEG, WebP, GIF of SVG tot 2 MB) of een video (**MP4** met H.264 of **WebM**, tot 25 MB; speelt zonder geluid).

- **Voor het inloggen**: één keer per bezoek vóór de inlogopties. **Wachttijd** bepaalt na hoeveel seconden de knop **Verder** verschijnt (0 = meteen). Werkt zonder JavaScript.
- **Na het inloggen**: op de pagina *Je bent verbonden*. Met een **link** opent een tik die pagina en telt als klik; de gast is dan al online.
- Een optionele **periode** (vanaf/tot en met) plant een advertentie in; **Actief** pauzeert hem. Bij meerdere actieve advertenties ziet elke gast een willekeurige.

Elke advertentie toont **weergaven**, **klikken** en de **CTR**, met weergaven per dag over de laatste 30 dagen. Video's worden in delen gestreamd (HTTP range requests), zodat ze op telefoons snel starten.

Tip: houd een splashvideo kort (5 tot 15 seconden) en onder 5 MB; gasten zitten op de wifi maar nog niet op internet terwijl de video van je server laadt.

## API

Alles hiervan zit in de klant-API met de scope `marketing`: `/api/v1/marketing-settings`, `/marketing/contacts` (ook `?format=csv`), `/marketing/sync`, `/marketing/forget`, `/marketing/privacy-requests`, `/survey-settings`, `/survey`, `/ads` en `/media/video` (stuur het bestand zelf met `Content-Type: video/mp4` of `video/webm`).
