# E-mail (SMTP)

> 🇳🇱 [Nederlandse versie](../nl/smtp.md)

Captive Portal sends mail through your own mail server: invitations, password resets and, later, notifications and monthly reports. E-mails are sent in the recipient's language. Configure it under **System → E-mail (SMTP)**.

## Settings

| Field | Explanation |
| --- | --- |
| Security | **STARTTLS** (port 587, encryption required, never falls back to plain text), **TLS/SSL** (port 465) or none (not recommended) |
| Minimum TLS version | TLS 1.2 (default) or TLS 1.3 |
| Verify certificate | Leave on, unless you use an internal server with its own certificate |
| Authentication | Username and password, OAuth 2.0, or none (IP relay) |
| DKIM | Optional: sign messages yourself when your mail server does not |

Passwords, client secrets and the DKIM key are stored encrypted and never sent back to the browser. Leave a secret field empty to keep the stored value.

**Send test e-mail** tests the settings as they are in the form, even before you save them.

## Microsoft 365

Microsoft is turning off Basic Auth for SMTP, so use **OAuth 2.0**:

1. Create an app registration in Entra (or use an existing one) with a client secret.
2. Under **API permissions**, add the application permission **Office 365 Exchange Online → SMTP.SendAsApp** and grant admin consent.
3. Register the service principal in Exchange Online and give it rights on the mailbox:
   ```powershell
   New-ServicePrincipal -AppId <client-id> -ObjectId <object-id-of-enterprise-app>
   Add-MailboxPermission -Identity noreply@yourdomain.com -User <object-id> -AccessRights FullAccess
   ```
4. Fill in Captive Portal:
   - Server `smtp.office365.com`, port `587`, STARTTLS
   - Method **OAuth 2.0**, username = the mailbox (`noreply@yourdomain.com`)
   - Token URL `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token`
   - Client ID and secret, scope `https://outlook.office365.com/.default`

## Google Workspace

Server `smtp.gmail.com`, port `587`, STARTTLS, with an **app password** of the sending account (requires 2-step verification), or `smtp-relay.gmail.com` with IP relay.

## Your own mail server

Prefer port 587 with STARTTLS or 465 with TLS. Make sure **SPF**, **DKIM** and **DMARC** are correct for the sender domain, otherwise mail ends up in spam.
