# E-mail (SMTP)

> 🇬🇧 [English version](../en/smtp.md)

Captive Portal verstuurt mail via je eigen mailserver: uitnodigingen, wachtwoordherstel, en later meldingen en maandrapportages. Instellen via **Systeem → E-mail (SMTP)**.

## Instellingen

| Veld | Uitleg |
| --- | --- |
| Beveiliging | **STARTTLS** (poort 587, verplicht versleuteld, valt nooit terug op onversleuteld), **TLS/SSL** (poort 465) of geen (niet aangeraden) |
| Minimale TLS-versie | TLS 1.2 (standaard) of TLS 1.3 |
| Certificaat controleren | Laat aan, tenzij je een interne server met een eigen certificaat gebruikt |
| Authenticatie | Gebruikersnaam en wachtwoord, OAuth 2.0, of geen (relay op IP) |
| DKIM | Optioneel: berichten zelf ondertekenen als je mailserver dat niet doet |

Wachtwoorden, client secrets en de DKIM-sleutel worden versleuteld opgeslagen en nooit teruggestuurd naar de browser. Laat een geheim veld leeg om de opgeslagen waarde te behouden.

Met **Verstuur testmail** test je de instellingen zoals ze in het formulier staan, ook voordat je ze opslaat.

## Microsoft 365

Microsoft schakelt Basic Auth voor SMTP uit; gebruik daarom **OAuth 2.0**:

1. Maak in Entra een app-registratie (of gebruik een bestaande) met een client secret.
2. Geef onder **API-machtigingen** de toepassingsmachtiging **Office 365 Exchange Online → SMTP.SendAsApp** en verleen beheerderstoestemming.
3. Registreer de service principal in Exchange Online en geef die rechten op de mailbox:
   ```powershell
   New-ServicePrincipal -AppId <client-id> -ObjectId <object-id-van-enterprise-app>
   Add-MailboxPermission -Identity noreply@jouwdomein.nl -User <object-id> -AccessRights FullAccess
   ```
4. Vul in Captive Portal in:
   - Server `smtp.office365.com`, poort `587`, STARTTLS
   - Methode **OAuth 2.0**, gebruikersnaam = de mailbox (`noreply@jouwdomein.nl`)
   - Token-URL `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token`
   - Client ID en secret, scope `https://outlook.office365.com/.default`

## Google Workspace

Server `smtp.gmail.com`, poort `587`, STARTTLS, met een **app-wachtwoord** van het verzendende account (vereist tweestapsverificatie), of `smtp-relay.gmail.com` met relay op IP.

## Eigen mailserver

Gebruik bij voorkeur poort 587 met STARTTLS of 465 met TLS. Zorg dat **SPF**, **DKIM** en **DMARC** voor het afzenderdomein kloppen, anders komt mail in de spam.
