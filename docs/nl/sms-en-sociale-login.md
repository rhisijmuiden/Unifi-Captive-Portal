# Sms en inloggen met Google, Apple en Microsoft

[English](../en/sms-social-login.md) · **Nederlands**

Naast gratis toegang, e-mail, vouchers, betalen en Facebook kunnen gasten een mobiel nummer bevestigen per sms of inloggen met Google, Apple of Microsoft. Je zet ze aan bij **Captive portals → Toegang & inloggen**. Een manier verschijnt pas op het gastportaal als de instellingen compleet zijn.

## Sms-verificatie

De gast typt een mobiel nummer, krijgt een code van zes cijfers en typt die terug. Je gebruikt je **eigen** Twilio- of MessageBird-account (Bird), dus de berichten en de kosten zijn van jou.

1. Zet **Sms-code** aan en kies de provider.
2. **Twilio**: plak de *Account SID* en *Auth token* uit de Twilio-console, en als afzender je Twilio-nummer (`+31…`), een afzendernaam of een *Messaging Service SID* (`MG…`).
   **MessageBird**: plak een *live API-sleutel* en de afzender (een nummer of maximaal 11 letters; niet elk land staat namen toe).
3. Stel de **standaard landcode** in (31 voor Nederland): gasten mogen dan `06 12345678` typen.
4. Stuur een **testbericht** naar je eigen telefoon en sla op.

Limieten die je tegoed beschermen:

- Een code is **10 minuten** geldig en mag **5 keer** worden geprobeerd.
- Maximaal **3 codes per gastpagina** en **5 per nummer per uur**, met 30 seconden tussen aanvragen.
- Een **maximum per dag** voor de hele klant (standaard 500).

De pagina toont hoeveel sms'jes er deze maand zijn verstuurd. Het bevestigde nummer staat bij de gast (zie **Gasten**), de manier is *Sms*.

## Google, Apple en Microsoft

Elke provider gebruikt je **eigen** app, zodat gasten jouw bedrijfsnaam zien. De pagina toont de exacte **redirect-URI** om te registreren; die gebruikt je eigen portalhostname zodra die actief is, dus koppel eerst je hostname. Klik na het invullen op **Koppeling testen**: het platform laat de provider je client-ID en geheim controleren.

### Google

1. Ga in [console.cloud.google.com](https://console.cloud.google.com) naar **API's en services → OAuth-toestemmingsscherm**, kies *Extern*, vul de appnaam in en zet de app op **In productie**.
2. Kies bij **Inloggegevens → Inloggegevens maken → OAuth-client-ID** voor *Webapplicatie* en plak de redirect-URI bij *Geautoriseerde omleidings-URI's*.
3. Plak de **client-ID** en het **clientgeheim**.

### Microsoft

1. Ga in [entra.microsoft.com](https://entra.microsoft.com) naar **App-registraties → Nieuwe registratie** en kies *Accounts in elke organisatiedirectory en persoonlijke Microsoft-accounts*.
2. Voeg bij **Verificatie** het platform **Web** toe met de redirect-URI.
3. Maak bij **Certificaten en geheimen** een clientgeheim. Plak de **Application (client) ID** en de **waarde** van het geheim. Laat **Tenant** op `common` staan (of `consumers` / `organizations` / je eigen tenant-ID om te beperken wie kan inloggen).

### Apple

Apple vraagt een betaald Apple Developer-account en een echte domeinnaam met HTTPS, dus koppel eerst je eigen hostname.

1. Maak op [developer.apple.com](https://developer.apple.com/account/resources/identifiers/list/serviceId) een **Services ID**, zet **Sign in with Apple** aan en vul je portalhostname in als domein en de redirect-URI als **Return URL**.
2. Maak bij **Keys** een sleutel met *Sign in with Apple* en download het `.p8`-bestand (kan maar één keer).
3. Vul de **Services ID**, je **Team ID** (rechtsboven in het developer-account) en de **Key ID** in en plak de inhoud van het `.p8`-bestand.

Apple deelt de naam alleen bij de allereerste keer inloggen, en gasten kunnen hun e-mailadres afschermen (je krijgt dan een adres op `privaterelay.appleid.com`).

### Instellingen voor alle sociale logins

- **Korte toegang om in te loggen** (0 tot 15 minuten, standaard 5): de gast krijgt langzaam internet om de inlogpagina van de provider te laden. Volledige toegang volgt zodra de provider de login bevestigt.
- **Walled garden**: de pagina toont de domeinen die je in UniFi bij **pre-authorization** zet voor de providers die je gebruikt. Dan werkt inloggen ook met korte toegang op 0.

Op het gastportaal delen alle sociale logins één tabblad (**Account**) met een knop per provider; met één provider draagt het tabblad de naam daarvan.

Designed by [RHIS](https://rhis.nl).
