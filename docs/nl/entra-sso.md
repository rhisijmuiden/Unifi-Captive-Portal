# Microsoft Entra ID (single sign-on)

> 🇬🇧 [English version](../en/entra-sso.md)

Met Entra SSO loggen gebruikers in met hun Microsoft-werkaccount. Wachtwoorden en MFA regelt Microsoft.

## 1. App-registratie in Entra

1. Ga naar het [Microsoft Entra-beheercentrum](https://entra.microsoft.com) → **Identiteit → Toepassingen → App-registraties → Nieuwe registratie**.
2. Naam: bijvoorbeeld `Captive Portal`.
3. Ondersteunde accounttypen: **Alleen accounts in deze organisatiemap** (één tenant).
4. Omleidings-URI: platform **Web**, adres:
   `https://<jouw-portal-adres>/api/auth/entra/callback`
   Het exacte adres staat met een kopieerknop op de pagina **Systeem → Single sign-on**. Het is gebaseerd op `PUBLIC_URL` in `/etc/captive-portal/captive-portal.env`.
5. Klik op **Registreren**.
6. Ga naar **Certificaten en geheimen → Nieuw clientgeheim**, kies een geldigheid en kopieer direct de **Waarde** (niet de geheim-ID).
7. Op de **Overzicht**-pagina staan de **Toepassings-ID (client)** en **Map-ID (tenant)**.

Microsoft staat `http://` alleen toe voor `localhost`. Gebruik voor productie een HTTPS-adres.

## 2. Instellen in Captive Portal

1. Ga naar **Systeem → Single sign-on**.
2. Vul Directory (tenant) ID, Application (client) ID en het client secret in.
3. Zet **Inloggen met Microsoft** aan en klik op **Opslaan**.

Het inlogscherm toont nu de knop **Inloggen met Microsoft**.

## Hoe gebruikers gekoppeld worden

- Een gebruiker moet eerst bestaan in Captive Portal (uitnodigen onder **Gebruikers**). Er worden geen accounts automatisch aangemaakt.
- Bij de eerste Microsoft-login wordt het account gekoppeld op e-mailadres. Daarna wordt de vaste Microsoft-ID (`oid`) gebruikt, ook als het e-mailadres later verandert.
- Onbekende Microsoft-accounts krijgen een duidelijke melding en geen toegang.

## Alleen Microsoft toestaan

Zet **Inloggen met wachtwoord toestaan** uit. Platformbeheerders kunnen dan nog steeds met wachtwoord inloggen via `/login?local=1`, zodat je jezelf niet buitensluit als er iets mis is met Entra.

## Problemen oplossen

| Melding | Oorzaak |
| --- | --- |
| `AADSTS50011` redirect URI mismatch | De omleidings-URI in Entra wijkt af van die op de SSO-pagina (let op http/https en de poort) |
| "Je Microsoft-account is niet gekoppeld" | Er bestaat geen gebruiker met dat e-mailadres; nodig de gebruiker eerst uit |
| "Inloggen met Microsoft is mislukt" | Verkeerd of verlopen client secret; zie `journalctl -u captive-portal` |
