# Guest access: sign-in, vouchers, payments and Facebook

**English** · [Nederlands](../nl/gasttoegang.md)

Under **Captive portals → Access & sign-in** you choose how guests get online. Switch on one or more ways; with more than one, guests see tabs on the portal.

| Way | What the guest does | What you get |
| --- | --- | --- |
| **Free with one tap** | Accepts the terms and taps *Connect*. | Device and time of the visit. |
| **Register with e-mail** | Fills in an e-mail address, and optionally name and phone number. | Contact details in **Guests** (CSV export). |
| **Voucher code** | Types a code you handed out. | Control over who gets online and for how long. |
| **Pay for access** | Chooses a package and pays with Mollie or Stripe. | The money, straight into your own account. |
| **Text message code** | Types a mobile number and the code from the text. | A confirmed phone number. See [SMS and social login](sms-social-login.md). |
| **Room number and surname** | Types the room number and surname. | Hotel guests online until departure. See [Hotel login](hotel-login.md). |
| **Continue with Facebook** | Signs in with Facebook. | Name and e-mail address from Facebook. |
| **Continue with Google, Apple or Microsoft** | Signs in with that account. | Name and e-mail address. See [SMS and social login](sms-social-login.md). |

On the same page you set the terms (per language), whether accepting them is required, the default time online, data and speed limits, and the page guests go to afterwards.

## E-mail registration

- **Name** and **Phone number** can each be *not asked*, *optional* or *required*.
- **Ask permission for news and offers** adds a separate, unticked checkbox. Only guests who tick it have *opt-in* in the guest list; use only those for marketing.
- **Send a welcome e-mail** sends the *Welcome for guests* e-mail; you can change it under **Guest e-mails**.

## Vouchers

Open **Captive portals → Vouchers** and click **Create vouchers**:

1. Choose how many codes, a batch name (for example *Reception October*), the time online per code and how many times a code may be used.
2. Optionally give the codes an expiry date and their own data and speed limits.
3. Click **Print** for a sheet with cut-out cards, ready to hand out.

Codes have 8 characters without look-alikes (no 0/O or 1/I). Guests may type them in lower case and with or without the dash. A code that is used up, revoked or expired is refused with a clear message.

## Paid access (Mollie or Stripe)

Guests pay you directly; the platform never holds the money. Under **Captive portals → Payments**:

1. **Provider settings**: choose Mollie or Stripe and paste your API key.
   - **Mollie**: Dashboard → Developers → API keys. Use a `test_` key first. The webhook address is set automatically.
   - **Stripe**: Developers → API keys (secret key `sk_…`). Then add a webhook in Stripe for the event `checkout.session.completed` (and optionally `checkout.session.expired`) with the address shown on the screen, and paste its signing secret (`whsec_…`).
2. Click **Test connection**.
3. **Packages**: create one or more packages, for example *Day pass, €4.95, 1 day*. A package can have its own data and speed limits.
4. Switch on **Pay for access** under **Access & sign-in**.

**Transactions** lists every payment with its status and the totals for this month.

### Time to pay

A guest who wants to pay is not online yet, so the payment page and the banking app cannot load. That is why the guest first gets a short, slow internet access (2 Mbit/s) to complete the payment:

1. The guest chooses a package and taps *Pay*.
2. The guest gets the set number of minutes of internet to pay.
3. As soon as the payment is confirmed, the guest gets the full package.

You set this time yourself under **Payments → Provider settings → Time to pay** (0 to 30 minutes, default 10). Ten minutes is long enough for iDEAL and banking apps and short enough to prevent abuse. If the guest does not pay, access simply ends.

With the time set to **0**, guests can only reach the hosts you allow in UniFi pre-authorization (see below), which often fails with banking apps. We recommend keeping a few minutes.

## Facebook login

Guests sign in with their Facebook account. You use your **own** Facebook app, so the Facebook screen shows your company name.

1. Go to [developers.facebook.com](https://developers.facebook.com), create an app of the type *Consumer* (or *Authenticate and request data from users*) and add the product **Facebook Login**.
2. Under **Facebook Login → Settings → Valid OAuth Redirect URIs**, paste the address shown under **Access & sign-in → Facebook login**. It uses your own portal hostname once that is active, so add your hostname first.
3. Copy the **App ID** and **App secret** from **App settings → Basic**, paste them on the platform and click **Test**.
4. Put the Facebook app *Live* (Facebook asks for a privacy policy link; use your website).

Like paying, logging in with Facebook needs internet before the guest is connected. **Time to log in** (0 to 15 minutes, default 5) gives the guest slow internet to sign in. The guest only gets full access after Facebook confirms the login.

Note: some phones open the portal in a small "captive portal" window. Facebook login works there in most cases; if a guest gets stuck, they can open the portal in the normal browser.

## UniFi pre-authorization

Hosts in the pre-authorization list of your Hotspot are reachable before a guest is connected. Besides the platform IP and your portal hostname (see [Connecting a UniFi console](unifi-setup.md)) you can add:

| For | Hosts |
| --- | --- |
| Mollie | `mollie.com`, `*.mollie.com`, `*.mollie.nl`, `ideal.nl`, `*.ideal.nl` |
| Stripe | `stripe.com`, `*.stripe.com`, `*.stripe.network`, `stripecdn.com`, `*.stripecdn.com` |
| Facebook | `facebook.com`, `*.facebook.com`, `*.fbcdn.net`, `*.facebook.net` |
| Google | `accounts.google.com`, `*.gstatic.com`, `oauth2.googleapis.com`, `fonts.googleapis.com`, `accounts.youtube.com` |
| Apple | `appleid.apple.com`, `idmsa.apple.com`, `*.apple.com`, `*.cdn-apple.com` |
| Microsoft | `login.microsoftonline.com`, `login.live.com`, `account.live.com`, `*.msauth.net`, `*.msftauth.net` |

This is optional when *time to pay* and *time to log in* are switched on.

Designed by [RHIS](https://rhis.nl).
