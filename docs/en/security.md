# Security, login details and two-factor authentication

**English** · [Nederlands](../nl/beveiliging.md)

## Two-factor authentication (2FA)

Every user can protect their account with a code from an authenticator app, on top of their password. It works with Microsoft Authenticator, Google Authenticator, 1Password, Bitwarden, Authy and every other app that supports TOTP (RFC 6238).

### Turning it on

1. Open **My account** (click your name at the bottom of the menu) and choose **Turn on two-factor authentication**.
2. Click **Start** and scan the QR code with your app. Scanning not possible? Choose manual entry in the app and type the key shown below the QR code.
3. Enter the six-digit code the app shows and click **Confirm and turn on**.
4. Save the ten **recovery codes** (copy them into your password manager or download them). Each code works once, for when your phone is not at hand. You only see them once; under **My account → New recovery codes** you can create a new set at any time.

From then on you are asked for a code after your password. A code can only be used once. After eight wrong codes in 15 minutes the account waits 15 minutes before it accepts codes again.

A password reset by e-mail does not skip the code: after choosing a new password you still enter the code from the app.

### Making it required

| Who | Where | Options |
| --- | --- | --- |
| Platform admin | **System → Security** | required for platform admins; required at customers for *admins* or *everyone* |
| Customer admin | **Team** (the card at the top) | required in your own team for *admins* or *everyone* |

The strictest policy applies. Anyone who must use 2FA and has not set it up yet gets the set-up screen straight after signing in and cannot do anything else until it is done. The Team page shows how many team members have it on, and every user has a green **2FA** badge once they do.

### Microsoft sign-in

People who sign in with **Microsoft (Entra ID)** do their extra verification at Microsoft, through Entra's own multi-factor authentication and conditional access. With **Signing in with Microsoft counts as two-factor** switched on (the default) they are not asked for a second code here. Switch it off to require the authenticator app for them too.

### Lost phone

- Use one of the recovery codes (**No phone at hand?** on the code screen), then create new codes or set up 2FA again on your new phone.
- Lost the codes as well? A customer admin (for their team) or the platform admin (for everyone) clicks the shield icon next to the user on **Team** or **Users** and chooses **Reset two-factor authentication**. The user's sessions end; they sign in with their password and set up 2FA again if it is required.

### API keys

API keys are not affected by 2FA: they are separate credentials with their own scopes, expiry and audit trail (see [API and webhooks](api.md)).

## Login details for new users

When you add a customer, a reseller or a user, you choose how that person gets in:

| Option | What happens |
| --- | --- |
| **Let them set a password** | An e-mail with a link to choose a password, valid for 7 days. Needs a working mail server (SMTP). |
| **Generate login details** | A strong password is created right away. You get the sign-in address, username and password on screen, with a **Copy message** button for a ready-made message to paste into WhatsApp or another chat app. No e-mail is sent. |
| **No e-mail** (users only) | No invitation and no password, for someone who signs in with Microsoft. |

Generated passwords are 20 random characters in four groups (such as `Q4fWB-Vv98h-b4nse-wRPCK`), without look-alike characters such as `0`/`O` and `1`/`l`. Only a hash is stored: the password is shown once and cannot be looked up later. The sign-in address is the reseller's own admin address when there is one.

With **Choose own password at first sign-in** (on by default) the person must replace the generated password straight after signing in, before they can do anything else; the old password then stops working. Someone who signs in with Microsoft is not asked.

Lost the details, or a user cannot receive e-mail? Under **Users** (or **Team**), the key button **Generate new login details** gives that person a new password and signs them out everywhere. It does not work on your own account: change your own password under **My account**.

## Other protections

- Passwords are stored with Argon2id; secrets (SMTP, SSO, payment keys, 2FA secrets) are encrypted with AES-256-GCM using `APP_SECRET`.
- Sign-in attempts are rate limited per address, and every sign-in, failed code and 2FA change is in the activity log.
- Sessions last seven days and end when a user is deactivated or their 2FA is reset.
