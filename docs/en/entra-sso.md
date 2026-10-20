# Microsoft Entra ID (single sign-on)

> 🇳🇱 [Nederlandse versie](../nl/entra-sso.md)

With Entra SSO, users sign in with their Microsoft work account. Microsoft handles passwords and MFA.

## 1. App registration in Entra

1. Go to the [Microsoft Entra admin center](https://entra.microsoft.com) → **Identity → Applications → App registrations → New registration**.
2. Name: for example `Captive Portal`.
3. Supported account types: **Accounts in this organizational directory only** (single tenant).
4. Redirect URI: platform **Web**, address:
   `https://<your-portal-address>/api/auth/entra/callback`
   The exact address, with a copy button, is on the **System → Single sign-on** page. It is based on `PUBLIC_URL` in `/etc/captive-portal/captive-portal.env`.
5. Click **Register**.
6. Go to **Certificates & secrets → New client secret**, choose an expiry and copy the **Value** right away (not the secret ID).
7. The **Overview** page shows the **Application (client) ID** and **Directory (tenant) ID**.

Microsoft only allows `http://` for `localhost`. Use an HTTPS address in production.

## 2. Set it up in Captive Portal

1. Go to **System → Single sign-on**.
2. Fill in the Directory (tenant) ID, Application (client) ID and client secret.
3. Turn on **Sign in with Microsoft** and click **Save**.

The sign-in page now shows the **Sign in with Microsoft** button, in the visitor's language unless you set your own text.

## How users are linked

- A user must exist in Captive Portal first (invite them under **Users**). No accounts are created automatically.
- On the first Microsoft sign-in, the account is linked by e-mail address. After that the fixed Microsoft ID (`oid`) is used, even if the e-mail address changes later.
- Unknown Microsoft accounts get a clear message and no access.

## Microsoft only

Turn off **Allow password sign-in**. Platform admins can still sign in with a password at `/login?local=1`, so you cannot lock yourself out if something is wrong with Entra.

## Troubleshooting

| Message | Cause |
| --- | --- |
| `AADSTS50011` redirect URI mismatch | The redirect URI in Entra differs from the one on the SSO page (check http/https and the port) |
| "Your Microsoft account is not linked" | No user with that e-mail address exists; invite the user first |
| "Signing in with Microsoft failed" | Wrong or expired client secret; see `journalctl -u captive-portal` |
