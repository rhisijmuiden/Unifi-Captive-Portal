# SMS and Google, Apple and Microsoft login

**English** · [Nederlands](../nl/sms-en-sociale-login.md)

Next to free access, e-mail, vouchers, payment and Facebook, guests can confirm a mobile number by text message or sign in with Google, Apple or Microsoft. You switch these on under **Captive portals → Access & sign-in**. A method only appears on the guest portal once its settings are complete.

## SMS verification

The guest types a mobile number, receives a six-digit code and types it back. You use your **own** Twilio or MessageBird (Bird) account, so the texts and the costs are yours.

1. Switch on **Text message code** and choose the provider.
2. **Twilio**: paste the *Account SID* and *Auth token* from the Twilio console, and as sender your Twilio number (`+31…`), an alphanumeric sender name or a *Messaging Service SID* (`MG…`).
   **MessageBird**: paste a *live API key* and the sender (a number or up to 11 letters; not every country allows names).
3. Set the **default country code** (31 for the Netherlands): guests may then type `06 12345678`.
4. Send a **test message** to your own phone and save.

Limits that protect your credit:

- A code is valid for **10 minutes** and can be tried **5 times**.
- At most **3 codes per guest page**, **5 per number per hour**, with 30 seconds between requests.
- A **maximum per day** for the whole customer (default 500).

The page shows how many texts were sent this month. The confirmed number is stored with the guest (see **Guests**), the method is *SMS*.

## Google, Apple and Microsoft

Each provider uses your **own** app, so guests see your company name. The page shows the exact **redirect URI** to register; it uses your own portal hostname once that is active, so add your hostname first. After filling in the details, click **Test connection**: the platform asks the provider to check your client ID and secret.

### Google

1. In [console.cloud.google.com](https://console.cloud.google.com), go to **APIs & Services → OAuth consent screen**, choose *External*, fill in the app name and set it to **In production**.
2. Under **Credentials → Create credentials → OAuth client ID**, choose *Web application* and paste the redirect URI under *Authorized redirect URIs*.
3. Paste the **client ID** and **client secret**.

### Microsoft

1. In [entra.microsoft.com](https://entra.microsoft.com), go to **App registrations → New registration** and choose *Accounts in any organizational directory and personal Microsoft accounts*.
2. Under **Authentication**, add the platform **Web** with the redirect URI.
3. Under **Certificates & secrets**, create a client secret. Paste the **Application (client) ID** and the secret's **value**. Leave **Tenant** at `common` (or `consumers` / `organizations` / your own tenant ID to limit who can sign in).

### Apple

Apple needs a paid Apple Developer account and a real domain with HTTPS, so connect your own hostname first.

1. On [developer.apple.com](https://developer.apple.com/account/resources/identifiers/list/serviceId), create a **Services ID**, enable **Sign in with Apple** and enter your portal hostname as domain and the redirect URI as **Return URL**.
2. Under **Keys**, create a key with *Sign in with Apple* and download the `.p8` file (only once possible).
3. Fill in the **Services ID**, your **Team ID** (top right in the developer account), the **Key ID** and paste the contents of the `.p8` file.

Apple only shares the name on the very first sign-in, and guests may hide their e-mail address (you then get a `privaterelay.appleid.com` address).

### Settings for all social logins

- **Short access to sign in** (0 to 15 minutes, default 5): the guest gets slow internet to load the provider's sign-in page. Full access follows once the provider confirms the login.
- **Walled garden**: the page lists the domains to add to UniFi **pre-authorization** for the providers you use. With these in place the sign-in also works with short access set to 0.

On the guest portal all social sign-ins share one tab (**Account**) with a button each; with just one provider the tab carries its name.

Designed by [RHIS](https://rhis.nl).
