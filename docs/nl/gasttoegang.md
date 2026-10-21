# Gasttoegang: inloggen, vouchers, betalingen en Facebook

[English](../en/guest-access.md) · **Nederlands**

Bij **Captive portals → Toegang & inloggen** kies je hoe gasten online komen. Zet één of meer manieren aan; bij meer dan één zien gasten tabbladen op het portaal.

| Manier | Wat de gast doet | Wat jij krijgt |
| --- | --- | --- |
| **Gratis met één tik** | Gaat akkoord met de voorwaarden en tikt op *Verbinden*. | Apparaat en tijdstip van het bezoek. |
| **Registreren met e-mail** | Vult een e-mailadres in, en eventueel naam en telefoonnummer. | Contactgegevens bij **Gasten** (CSV-export). |
| **Vouchercode** | Typt een code die je hebt uitgedeeld. | Controle over wie online komt en hoe lang. |
| **Betalen voor toegang** | Kiest een pakket en betaalt met Mollie of Stripe. | Het geld, direct op je eigen rekening. |
| **Sms-code** | Typt een mobiel nummer en de code uit de sms. | Een bevestigd telefoonnummer. Zie [Sms en sociale login](sms-en-sociale-login.md). |
| **Kamernummer en achternaam** | Typt kamernummer en achternaam. | Hotelgasten online tot vertrek. Zie [Hotellogin](hotellogin.md). |
| **Doorgaan met Facebook** | Logt in met Facebook. | Naam en e-mailadres van Facebook. |
| **Doorgaan met Google, Apple of Microsoft** | Logt in met dat account. | Naam en e-mailadres. Zie [Sms en sociale login](sms-en-sociale-login.md). |

Op dezelfde pagina stel je de voorwaarden in (per taal), of akkoord gaan verplicht is, de standaardtijd online, data- en snelheidslimieten en de pagina waar gasten daarna naartoe gaan.

## Registreren met e-mail

- **Naam** en **Telefoonnummer** kunnen elk *niet vragen*, *optioneel* of *verplicht* zijn.
- **Toestemming vragen voor nieuws en aanbiedingen** voegt een apart, niet aangevinkt vakje toe. Alleen gasten die het aanvinken hebben *opt-in* in de gastenlijst; gebruik alleen die voor marketing.
- **Welkomstmail sturen** stuurt de e-mail *Welkom voor gasten*; die pas je aan bij **Gast-e-mails**.

## Vouchers

Open **Captive portals → Vouchers** en klik op **Vouchers aanmaken**:

1. Kies hoeveel codes, een naam voor de reeks (bijvoorbeeld *Receptie oktober*), de tijd online per code en hoe vaak een code gebruikt mag worden.
2. Geef de codes eventueel een vervaldatum en eigen data- en snelheidslimieten.
3. Klik op **Printen** voor een vel met kaartjes om uit te knippen en uit te delen.

Codes hebben 8 tekens zonder tekens die op elkaar lijken (geen 0/O of 1/I). Gasten mogen ze in kleine letters typen, met of zonder streepje. Een code die op, ingetrokken of verlopen is, wordt geweigerd met een duidelijke melding.

## Betaalde toegang (Mollie of Stripe)

Gasten betalen jou rechtstreeks; het platform houdt nooit geld vast. Bij **Captive portals → Betalingen**:

1. **Betaalprovider**: kies Mollie of Stripe en plak je API-sleutel.
   - **Mollie**: Dashboard → Developers → API-keys. Gebruik eerst een `test_`-sleutel. Het webhook-adres wordt automatisch ingesteld.
   - **Stripe**: Developers → API keys (geheime sleutel `sk_…`). Voeg daarna in Stripe een webhook toe voor het event `checkout.session.completed` met het adres dat op het scherm staat, en plak het signing secret (`whsec_…`).
2. Klik op **Verbinding testen**.
3. **Pakketten**: maak één of meer pakketten, bijvoorbeeld *Dagpas, € 4,95, 1 dag*. Een pakket kan eigen data- en snelheidslimieten hebben.
4. Zet **Betalen voor toegang** aan bij **Toegang & inloggen**.

**Transacties** toont elke betaling met de status en de totalen van deze maand.

### Tijd om te betalen

Een gast die wil betalen is nog niet online, dus de betaalpagina en de bankapp kunnen niet laden. Daarom krijgt de gast eerst kort, langzaam internet (2 Mbit/s) om de betaling af te ronden:

1. De gast kiest een pakket en tikt op *Betalen*.
2. De gast krijgt het ingestelde aantal minuten internet om te betalen.
3. Zodra de betaling bevestigd is, krijgt de gast het volledige pakket.

Je stelt deze tijd zelf in bij **Betalingen → Betaalprovider → Tijd om te betalen** (0 tot 30 minuten, standaard 10). Tien minuten is lang genoeg voor iDEAL en bankapps en kort genoeg om misbruik te voorkomen. Betaalt de gast niet, dan stopt de toegang gewoon.

Met de tijd op **0** kunnen gasten alleen de hosts bereiken die je in UniFi pre-autorisatie toestaat (zie hieronder), en dat gaat met bankapps vaak mis. We raden aan een paar minuten te houden.

## Inloggen met Facebook

Gasten loggen in met hun Facebook-account. Je gebruikt je **eigen** Facebook-app, zodat het Facebook-scherm jouw bedrijfsnaam toont.

1. Ga naar [developers.facebook.com](https://developers.facebook.com), maak een app van het type *Consumer* (of *Gebruikers verifiëren en gegevens opvragen*) en voeg het product **Facebook Login** toe.
2. Plak bij **Facebook Login → Instellingen → Geldige OAuth-omleidings-URI's** het adres dat bij **Toegang & inloggen → Inloggen met Facebook** staat. Dat gebruikt je eigen portaal-hostnaam zodra die actief is, dus voeg eerst je hostnaam toe.
3. Kopieer de **App-ID** en het **App-geheim** uit **App-instellingen → Basis**, plak ze op het platform en klik op **Testen**.
4. Zet de Facebook-app op *Live* (Facebook vraagt om een link naar een privacybeleid; gebruik je website).

Net als betalen heeft inloggen met Facebook internet nodig voordat de gast verbonden is. **Tijd om in te loggen** (0 tot 15 minuten, standaard 5) geeft de gast traag internet om in te loggen. De gast krijgt pas volledige toegang als Facebook de login bevestigt.

Let op: sommige telefoons openen het portaal in een klein "captive portal"-venster. Inloggen met Facebook werkt daar meestal; loopt een gast vast, dan kan die het portaal in de gewone browser openen.

## UniFi pre-autorisatie

Hosts in de pre-autorisatielijst van je Hotspot zijn bereikbaar voordat een gast verbonden is. Naast het IP-adres van het platform en je portaal-hostnaam (zie [UniFi-console koppelen](unifi-koppelen.md)) kun je toevoegen:

| Voor | Hosts |
| --- | --- |
| Mollie | `mollie.com`, `*.mollie.com`, `*.mollie.nl`, `ideal.nl`, `*.ideal.nl` |
| Stripe | `stripe.com`, `*.stripe.com`, `*.stripe.network`, `stripecdn.com`, `*.stripecdn.com` |
| Facebook | `facebook.com`, `*.facebook.com`, `*.fbcdn.net`, `*.facebook.net` |
| Google | `accounts.google.com`, `*.gstatic.com`, `oauth2.googleapis.com`, `fonts.googleapis.com`, `accounts.youtube.com` |
| Apple | `appleid.apple.com`, `idmsa.apple.com`, `*.apple.com`, `*.cdn-apple.com` |
| Microsoft | `login.microsoftonline.com`, `login.live.com`, `account.live.com`, `*.msauth.net`, `*.msftauth.net` |

Dit is optioneel als *tijd om te betalen* en *tijd om in te loggen* aan staan.

Designed by [RHIS](https://rhis.nl).
