# API en webhooks

> 🇬🇧 [English version](../en/api.md)

Alles wat je in de webinterface kunt, kan ook via de REST API. Zo koppel je andere systemen (een hotelsysteem, CRM, monitoring, je eigen website). Er zijn twee API's:

| | Wie | Wat |
| --- | --- | --- |
| **Klant-API** | klantbeheerders, onder **API** in hun eigen omgeving | consoles, hostnames, portalinstellingen en ontwerp, gasten, vouchers, betalingen en pakketten, meldingen en gastmails, rapporten, teamleden en hun eigen facturen |
| **Platform-API** | de platformbeheerder, onder **Systeem → API** | klanten (aanmaken, wijzigen, opschorten, verwijderen, met een eerste beheerder), gebruikers, serverinstellingen (SMTP, SSO, hosting, facturatie-instellingen), e-mailtemplates van het platform, facturatie, back-ups en updates |

De twee overlappen nooit: een klantsleutel ziet geen andere klanten of serverinstellingen, en een platformsleutel kan niet bij de portals van klanten. Dat volgt dezelfde verdeling als de webinterface.

## In het kort

- Adres: `https://<beheerhostname>/api/v1/…` (staat op de API-pagina met een kopieerknop).
- Inloggen met een **API-sleutel** in de header: `Authorization: Bearer cpk_…`.
- Elke sleutel heeft **scopes** per onderdeel, lezen of schrijven (schrijven omvat lezen), een optionele **vervaldatum** en een **rate limit** per minuut.
- Elk verzoek met een sleutel wordt 90 dagen bewaard in de **audit trail** van die sleutel; wijzigingen via de API staan ook in het activiteitenlogboek, met de sleutel erbij.
- **Webhooks** sturen een ondertekend bericht naar je systeem zodra er iets gebeurt.
- Het tabblad **Documentatie** beschrijft elke bewerking in het Nederlands en Engels en laat je ze uitproberen. De OpenAPI 3.1-beschrijving staat op `/api/v1/openapi.json`, voor Postman, Insomnia of codegeneratoren.

## 1. Sleutel aanmaken

1. Open **API** in het menu (klanten) of **Systeem → API** (platformbeheerder) en klik op **Nieuwe API-sleutel**.
2. Geef een naam die zegt waar hij voor is, zoals "Hotel-PMS".
3. Kies de **scopes**: per onderdeel *Geen*, *Lezen* of *Schrijven*. Geef een sleutel alleen wat hij nodig heeft.
4. Kies wanneer hij **verloopt**: over 30 dagen, 90 dagen, een jaar, op een datum, of nooit.
5. Stel het aantal **verzoeken per minuut** in (standaard 120).
6. Klik op **Sleutel aanmaken** en **kopieer de sleutel meteen**. Hij wordt maar één keer getoond; daarna zie je alleen de eerste tekens (`cpk_xxxxxxxx…`).

Naam, scopes, limiet en vervaldatum wijzig je later met het potlood. **Intrekken** stopt een sleutel meteen (hij blijft in de lijst staan met zijn audit trail); **Verwijderen** haalt hem weg, samen met de audit trail.

Een klantsleutel werkt als klantbeheerder van die klant; een platformsleutel als platformbeheerder. Binnen die rol bepalen de scopes wat de sleutel mag. Een sleutel werkt niet meer als hij verlopen of ingetrokken is, of als zijn klant is opgeschort.

## 2. Een verzoek doen

```bash
curl https://portal.voorbeeld.nl/api/v1/vouchers \
  -H "Authorization: Bearer cpk_…"

curl -X POST https://portal.voorbeeld.nl/api/v1/vouchers \
  -H "Authorization: Bearer cpk_…" \
  -H "Content-Type: application/json" \
  -d '{"count": 10, "durationMinutes": 1440, "batch": "Receptie"}'
```

Voorbeeld voor het platform: een klant aanmaken met een eerste beheerder, die meteen de uitnodigingsmail krijgt:

```bash
curl -X POST https://portal.voorbeeld.nl/api/v1/tenants \
  -H "Authorization: Bearer cpk_…" \
  -H "Content-Type: application/json" \
  -d '{"name": "Hotel De Haven", "slug": "hotel-de-haven", "admin": {"name": "Anna", "email": "anna@dehaven.nl"}}'
```

Antwoorden zijn JSON. Fouten zien eruit als `{"error": "…"}`:

| Status | Betekenis |
| --- | --- |
| 400 | Ongeldige invoer; de melding zegt welk veld |
| 401 | Sleutel ontbreekt, is onbekend, verlopen of ingetrokken |
| 403 | De sleutel heeft de scope niet; de melding noemt hem, bv. `vouchers:write` |
| 404 | Niet gevonden, of de bewerking zit niet in de API |
| 429 | Rate limit bereikt; wacht het aantal seconden uit `Retry-After` |

Foutmeldingen zijn standaard Engels; stuur `Accept-Language: nl` of `X-Locale: nl` mee voor Nederlands.

Elk antwoord bevat `X-RateLimit-Limit`, `X-RateLimit-Remaining` en `X-RateLimit-Reset` (seconden tot de minuut opnieuw begint).

## 3. Documentatie en verkenner

Het tabblad **Documentatie** toont elke bewerking per onderdeel, met scope, parameters en request body. Klap een bewerking open, plak een sleutel en klik op **Verzoek versturen** om hem uit te proberen; de sleutel wordt alleen op die pagina gebruikt en niet opgeslagen. Bij elke bewerking staat ook het bijbehorende cURL-commando. Let op: schrijvende bewerkingen wijzigen echt gegevens.

**OpenAPI (EN)** en **OpenAPI (NL)** downloaden de beschrijving. Hij is ook openbaar op:

- `/api/v1/openapi.json?audience=tenant&lang=nl` (klant-API)
- `/api/v1/openapi.json?audience=platform&lang=nl` (platform-API)

## 4. Webhooks

Klik op het tabblad **Webhooks** op **Nieuwe webhook**, vul het adres in en kies de gebeurtenissen. Je krijgt een **ondertekeningsgeheim** (`whsec_…`); dat kun je later opnieuw tonen of vervangen door een nieuw geheim.

Gebeurtenissen voor klanten: `guest.authorized`, `payment.paid`, `hostname.active`, `console.offline`, `console.online`, `device.offline`, `device.online`, `invoice.issued`, `invoice.paid`.
Gebeurtenissen voor het platform: `tenant.created`, `tenant.updated`, `tenant.deleted`, `invoice.issued`, `invoice.paid`, `backup.succeeded`, `backup.failed`.

Elke gebeurtenis is een `POST` met JSON:

```http
POST /jouw/adres
Content-Type: application/json
X-Webhook-Id: 0b6f…
X-Webhook-Event: guest.authorized
X-Webhook-Timestamp: 1792540000
X-Webhook-Signature: v1=5d41402abc4b2a76b9719d911017c592…

{"id":"0b6f…","event":"guest.authorized","createdAt":"2026-10-21T09:00:00.000Z","tenantId":"…","data":{…}}
```

**Controleer de handtekening** voordat je een bericht vertrouwt: bereken HMAC-SHA256 met het geheim over `<X-Webhook-Timestamp>.<ruwe body>` en vergelijk die in hex met het deel na `v1=`. Weiger berichten met een tijdstempel ouder dan vijf minuten. Een Node.js-voorbeeld staat op de pagina nadat je een webhook hebt aangemaakt.

Antwoord binnen 10 seconden met een `2xx`-status. Anders wordt de aflevering opnieuw geprobeerd na 1, 5 en 30 minuten, daarna na 2, 6 en 24 uur. Na 50 mislukte pogingen achter elkaar wordt de webhook uitgezet; zet hem weer aan zodra je adres weer werkt. **Testen** stuurt meteen een `ping`; **Afleveringen** toont de laatste 100 afleveringen met het antwoord van je systeem, en **Opnieuw sturen** probeert er één nog eens.

Webhooks van klanten moeten `https://` en een openbaar adres gebruiken; adressen op een privé- of lokaal netwerk worden geweigerd, ook als een domeinnaam naar zo'n adres wijst. Webhooks van het platform mogen `http://` en je eigen netwerk gebruiken, bijvoorbeeld voor interne monitoring.

## Wat niet in de API zit

- Inloggen, wachtwoorden en accounts, en het beheer van API-sleutels en webhooks zelf (alleen in de webinterface).
- **Een back-up terugzetten**: dat vervangt de hele database en blijft daarom in de webinterface. Back-ups maken en locaties beheren kan wel via de API.
- Testmails die naar de ingelogde gebruiker gaan (template testen, rapport als voorbeeld).
