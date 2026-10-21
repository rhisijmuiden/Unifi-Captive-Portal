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
| EHLO-naam | Hostnaam waarmee de app zich bij de mailserver meldt; leeg = admin-hostnaam of de FQDN van de server |
| DKIM | Optioneel: sleutel genereren en berichten zelf ondertekenen als je mailserver dat niet doet |

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

Gebruik bij voorkeur poort 587 met STARTTLS of 465 met TLS, en log in met een mailbox van het afzenderdomein. Relayt je server alleen op IP (bijvoorbeeld een Proxmox Mail Gateway), zet het IP-adres van deze server dan bij de vertrouwde relay-netwerken.

## Mail uit de spam houden

Spamfilters kijken naar drie dingen: de naam waarmee de app zich bij de mailserver meldt, en de SPF-, DKIM- en DMARC-records van het afzenderdomein. Klik op **DNS controleren** onder **Afleverbaarheidscontrole** om ze allemaal te zien voor de instellingen in het formulier.

### EHLO-naam

De app stelt zich met een hostnaam voor aan de mailserver. Zonder hostnaam zou hij zich melden als `[127.0.0.1]`, en daar geeft SpamAssassin strafpunten voor (`HELO_MISC_IP`). Laat **EHLO-naam** leeg om de admin-hostnaam (Hosting & SSL) of de eigen FQDN van de server te gebruiken, of vul zelf een hostnaam in, zoals `portal.jouwbedrijf.nl`.

### SPF

Eén TXT-record op het afzenderdomein met de servers die namens dat domein mogen mailen, bijvoorbeeld:

```
jouwbedrijf.nl.  TXT  "v=spf1 mx ip4:203.0.113.7 ~all"
```

Zet erin vanaf welk IP-adres de mail het internet op gaat: je mailserver (vaak al gedekt door `mx`) of deze server als die zelf aflevert. Maak nooit een tweede SPF-record aan; voeg samen met het bestaande.

### DKIM

Ondertekent je mailserver uitgaande mail niet zelf, laat de app het dan doen:

1. Zet **Berichten ondertekenen met DKIM** aan, controleer het domein (het afzenderdomein) en de selector (standaard `portal`).
2. Klik op **Sleutel genereren**. De private key wordt versleuteld opgeslagen; de pagina toont het **DNS-record om te publiceren**.
3. Maak dat TXT-record, bijvoorbeeld `portal._domainkey.jouwbedrijf.nl`, aan bij je DNS-provider.
4. Klik op **DNS controleren** tot DKIM een match geeft.

Een nieuwe sleutel genereren vervangt de oude, dus publiceer het nieuwe record meteen. Je kunt ook je eigen private key (PEM) plakken.

### DMARC

DMARC vertelt ontvangers wat ze moeten doen als SPF en DKIM allebei niet slagen voor het afzenderdomein. Begin met:

```
_dmarc.jouwbedrijf.nl.  TXT  "v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc@jouwbedrijf.nl"
```

Met `p=quarantine` of `p=reject` wordt mail van het portaal alleen afgeleverd als SPF of DKIM slaagt **voor het afzenderdomein**. DKIM-ondertekening door de app is de betrouwbaarste manier om dat te bereiken.
