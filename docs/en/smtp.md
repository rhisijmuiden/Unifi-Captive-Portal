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
| EHLO name | Hostname the app greets the mail server with; empty = admin hostname or the server's FQDN |
| DKIM | Optional: generate a key and sign messages yourself when your mail server does not |

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

Prefer port 587 with STARTTLS or 465 with TLS, and sign in with a mailbox of the sender domain. If your server only relays by IP (for example a Proxmox Mail Gateway), add this server's IP address to its trusted relay networks.

## Keeping mail out of spam

Spam filters look at three things: the name the app greets the mail server with, and the SPF, DKIM and DMARC records of the sender domain. Click **Check DNS** under **Deliverability check** to see all of them for the settings in the form.

### EHLO name

The app introduces itself to the mail server with a hostname. Without one it would greet with `[127.0.0.1]`, which SpamAssassin punishes (`HELO_MISC_IP`). Leave **EHLO name** empty to use the admin hostname (Hosting & SSL) or the server's own FQDN, or fill in a hostname yourself, such as `portal.yourcompany.com`.

### SPF

One TXT record on the sender domain that lists the servers allowed to send for it, for example:

```
yourcompany.com.  TXT  "v=spf1 mx ip4:203.0.113.7 ~all"
```

Add the IP address the mail leaves from to the internet: your mail server (often covered by `mx`) or this server when it delivers mail itself. Never create a second SPF record; merge into the existing one.

### DKIM

When your mail server does not sign outgoing mail itself, let the app do it:

1. Turn on **Sign messages with DKIM**, check the domain (the sender domain) and selector (default `portal`).
2. Click **Generate key**. The private key is stored encrypted; the page shows the **DNS record to publish**.
3. Create that TXT record, e.g. `portal._domainkey.yourcompany.com`, at your DNS provider.
4. Run **Check DNS** until DKIM shows a match.

Generating a new key replaces the old one, so publish the new record straight away. You can also paste your own private key (PEM).

### DMARC

DMARC tells receivers what to do when neither SPF nor DKIM passes for the sender domain. Start with:

```
_dmarc.yourcompany.com.  TXT  "v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc@yourcompany.com"
```

With `p=quarantine` or `p=reject`, mail from the portal is only delivered when SPF or DKIM passes **for the sender domain**. DKIM signing by the app is the most reliable way to get there.
