# Beveiliging, inloggegevens en tweestapsverificatie

[English](../en/security.md) · **Nederlands**

## Tweestapsverificatie (2FA)

Elke gebruiker kan zijn account beveiligen met een code uit een authenticator-app, bovenop het wachtwoord. Het werkt met Microsoft Authenticator, Google Authenticator, 1Password, Bitwarden, Authy en elke andere app die TOTP (RFC 6238) ondersteunt.

### Aanzetten

1. Open **Mijn account** (klik op je naam onderaan het menu) en kies **Tweestapsverificatie aanzetten**.
2. Klik op **Beginnen** en scan de QR-code met je app. Scannen lukt niet? Kies in de app voor handmatig invoeren en typ de sleutel onder de QR-code over.
3. Vul de zescijferige code uit de app in en klik op **Bevestigen en aanzetten**.
4. Bewaar de tien **herstelcodes** (kopieer ze naar je wachtwoordmanager of download ze). Elke code werkt één keer, voor als je je telefoon niet bij de hand hebt. Je ziet ze maar één keer; via **Mijn account → Nieuwe herstelcodes** maak je op elk moment een nieuwe set.

Vanaf dan vragen we na je wachtwoord om een code. Een code werkt maar één keer. Na acht verkeerde codes binnen 15 minuten wacht het account 15 minuten voordat het weer codes accepteert.

Een wachtwoordreset per e-mail slaat de code niet over: na het kiezen van een nieuw wachtwoord vul je nog steeds de code uit de app in.

### Verplicht maken

| Wie | Waar | Keuzes |
| --- | --- | --- |
| Platformbeheerder | **Systeem → Beveiliging** | verplicht voor platformbeheerders; verplicht bij klanten voor *beheerders* of *iedereen* |
| Klantbeheerder | **Team** (de kaart bovenaan) | verplicht in je eigen team voor *beheerders* of *iedereen* |

Het strengste beleid geldt. Wie 2FA moet gebruiken en het nog niet heeft, krijgt direct na het inloggen het instelscherm en kan niets anders doen tot het klaar is. De Team-pagina laat zien hoeveel teamleden het aan hebben, en elke gebruiker krijgt dan een groen **2FA**-label.

### Inloggen met Microsoft

Wie inlogt met **Microsoft (Entra ID)** doet de extra verificatie bij Microsoft, via de eigen meervoudige verificatie en voorwaardelijke toegang van Entra. Met **Inloggen met Microsoft telt als tweestapsverificatie** aan (standaard) vragen we hen hier geen tweede code. Zet het uit om ook voor hen de authenticator-app te verplichten.

### Telefoon kwijt

- Gebruik een van de herstelcodes (**Telefoon niet bij de hand?** op het codescherm) en maak daarna nieuwe codes of stel 2FA opnieuw in op je nieuwe telefoon.
- Ook de codes kwijt? Een klantbeheerder (voor zijn team) of de platformbeheerder (voor iedereen) klikt op het schildje naast de gebruiker bij **Team** of **Gebruikers** en kiest **Tweestapsverificatie resetten**. De sessies van die gebruiker worden beëindigd; hij logt in met zijn wachtwoord en stelt 2FA opnieuw in als het verplicht is.

### API-sleutels

API-sleutels staan los van 2FA: het zijn aparte inloggegevens met eigen scopes, vervaldatum en audittrail (zie [API en webhooks](api.md)).

## Inloggegevens voor nieuwe gebruikers

Als je een klant, reseller of gebruiker toevoegt, kies je hoe die persoon binnenkomt:

| Optie | Wat er gebeurt |
| --- | --- |
| **Zelf wachtwoord laten instellen** | Een e-mail met een link om een wachtwoord te kiezen, 7 dagen geldig. Werkt alleen met een ingestelde mailserver (SMTP). |
| **Inloggegevens genereren** | Er wordt direct een sterk wachtwoord aangemaakt. Je krijgt het inlogadres, de gebruikersnaam en het wachtwoord op het scherm, met een knop **Bericht kopiëren** voor een kant-en-klaar bericht om in WhatsApp of een andere chatapp te plakken. Er gaat geen e-mail uit. |
| **Geen e-mail** (alleen bij gebruikers) | Geen uitnodiging en geen wachtwoord, voor iemand die met Microsoft inlogt. |

Gegenereerde wachtwoorden zijn 20 willekeurige tekens in vier groepjes (zoals `Q4fWB-Vv98h-b4nse-wRPCK`), zonder tekens die op elkaar lijken zoals `0`/`O` en `1`/`l`. Alleen een hash wordt bewaard: het wachtwoord wordt één keer getoond en is later niet meer op te vragen. Het inlogadres is het eigen beheeradres van de reseller als die er een heeft.

Met **Eigen wachtwoord kiezen bij eerste keer inloggen** (standaard aan) moet de persoon direct na het inloggen het gegenereerde wachtwoord vervangen, voordat er iets anders kan; het oude wachtwoord werkt daarna niet meer. Wie met Microsoft inlogt krijgt deze vraag niet.

## Wachtwoord resetten

Wachtwoord vergeten, gegevens kwijt, of kan iemand geen e-mail ontvangen? Je hoeft een account nooit te verwijderen en opnieuw aan te maken. Open **Wachtwoord resetten** op een van deze plekken:

- **Gebruikers** (of **Team**): de sleutelknop bij de persoon, of de knop **Wachtwoord resetten** in het bewerkvenster.
- **Klanten** en **Resellers**: de sleutelknop op de regel. Kies welke persoon van die klant of reseller (beheerders staan bovenaan).

Kies daarna hoe:

- **Reset-e-mail sturen**: de persoon krijgt een link om een nieuw wachtwoord te kiezen (1 uur geldig). Tot die tijd blijft het huidige wachtwoord werken. Wie nog nooit een wachtwoord koos, krijgt in plaats daarvan een nieuwe uitnodiging (7 dagen geldig). Alleen mogelijk als de mailserver is ingesteld via **E-mail (SMTP)**.
- **Nieuwe inloggegevens genereren**: er wordt direct een nieuw wachtwoord gemaakt en één keer getoond, met een kant-en-klaar bericht om in WhatsApp te plakken. Het oude wachtwoord werkt niet meer en de persoon wordt overal afgemeld. Met **Eigen wachtwoord kiezen bij eerste keer inloggen** vervangt de persoon het meteen.

Tweestapsverificatie blijft na een reset aan; is de telefoon ook kwijt, gebruik dan ook **Tweestapsverificatie resetten**. Resetten werkt niet op je eigen account: je eigen wachtwoord wijzig je via **Mijn account**.

## Overige beveiliging

- Wachtwoorden worden opgeslagen met Argon2id; geheimen (SMTP, SSO, betaalsleutels, 2FA-sleutels) worden versleuteld met AES-256-GCM op basis van `APP_SECRET`.
- Inlogpogingen zijn per adres begrensd, en elke aanmelding, verkeerde code en 2FA-wijziging staat in het activiteitenlogboek.
- Sessies duren zeven dagen en eindigen als een gebruiker wordt gedeactiveerd of zijn 2FA wordt gereset.
