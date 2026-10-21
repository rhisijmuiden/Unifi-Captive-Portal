# Newsletter, GDPR, feedback and ads

**English** · [Nederlands](../nl/marketing-feedback-advertenties.md)

Three pages under **Marketing** in the customer's own environment help you do more with the guest Wi-Fi: collect newsletter subscribers with consent, handle deletion requests, ask guests for a rating and a Google review, and show an image or splash video.

## Newsletter & GDPR

### Collecting subscribers

1. Under **Captive portals → Access & sign-in**, switch on **E-mail** (and/or Google, Apple, Microsoft or Facebook) and, under **E-mail registration**, **Ask permission for news and offers**.
2. Guests now see an unticked box *I would like to receive news and offers now and then* on the e-mail form and the **Account** tab. Only guests who tick it themselves count as opted in.
3. Every guest who signs in with an e-mail address (e-mail, Google, Apple, Microsoft, Facebook, payment) appears on **Marketing → Newsletter & GDPR** with name, visits and last visit. Once opted in, a contact stays opted in on later visits until the data is erased.

**Download CSV** exports the opt-ins (or all contacts) for any other mailing tool. Cells that start with `=`, `+`, `-` or `@` are prefixed with `'` so spreadsheet programs do not run them as formulas.

### Mailchimp

1. In Mailchimp go to **Profile → Extras → API keys** and create a key. It ends in your data centre, for example `…-us21`.
2. Find the **Audience ID** under **Audience → Settings → Audience name and defaults**.
3. Choose **Mailchimp** under **Newsletter connection**, fill in both and click **Test connection**; the name of the audience is shown.
4. **Double opt-in** lets Mailchimp first send its own confirmation e-mail (the contact is *pending* until confirmed).

Contacts are added or updated with first name, last name, language and the tag `wifi`.

### HubSpot

1. In HubSpot go to **Settings → Integrations → Private apps** and create an app with the scopes `crm.objects.contacts.read` and `crm.objects.contacts.write`.
2. Choose **HubSpot**, paste the token and click **Test connection**.

Contacts are created or updated by e-mail address with first name, last name and phone number.

### Sending

With **Send automatically** on, a new or changed opt-in is sent right away, and anything that failed is retried every 15 minutes. **Send now** sends everything waiting. The **Newsletter** column shows *Opted in* (waiting), *Sent* or *Error* (hover for the reason).

### Retention

**Retention without opt-in** (default *Keep*) erases name, e-mail and phone of guests who did **not** opt in after 30 days to 2 years. Sessions stay as anonymous statistics. Opted-in contacts are kept until they ask to be erased.

### Deletion requests (right to erasure)

- Every guest page now has a **Privacy** link at the bottom, next to *Designed by RHIS*. The guest types an e-mail address and gets an e-mail with a confirmation button, valid for 48 hours. The page always says *check your mailbox*, so nobody can find out which addresses are known.
- After confirming, the name, e-mail and phone are removed from every visit, the contact is deleted, and the address is also removed **at Mailchimp** (permanent delete) or **HubSpot** (GDPR delete).
- You can also erase an address yourself with **Erase all**. Both show up in the list of requests; the address itself is not kept, only a hash.
- The confirmation e-mail is the template **Erase request (guests)** under **Insights → Guest e-mails**, which you can change per language.
- The privacy page is at `https://<your hostname>/portal/privacy` (or `/portal/privacy/<customer-slug>` on the platform address), so you can also link to it from your own privacy statement.

## Feedback: survey and Google review

On **Marketing → Feedback**, switch on **Show the survey**. After signing in, the *You are connected* page asks your question (per language, default *How was your visit?*) with 1 to 5 stars and optionally a comment. Answering is never required, and each visit can answer once.

With a **Google review link** (Google Business Profile → **Ask for reviews** → copy the link), the guest gets a **Write a review on Google** button after answering. Google does not allow asking only satisfied guests for a review, so the button is shown to everyone; you can switch it off and keep only the survey.

The page shows the average, the distribution per star and the latest comments for 30, 90 or 365 days. The same figures are in the API (`GET /api/v1/survey`).

## Ads and splash video

On **Marketing → Ads**, add an image (PNG, JPEG, WebP, GIF or SVG up to 2 MB) or a video (**MP4** with H.264 or **WebM**, up to 25 MB; it plays muted).

- **Before sign-in**: shown once per visit before the sign-in options. **Wait** sets after how many seconds the **Continue** button appears (0 = right away). It works without JavaScript.
- **After sign-in**: shown on the *You are connected* page. With a **link**, a tap opens that page and counts as a click; guests are online by then.
- An optional **period** (from/until) plans an ad; **Active** pauses it. With several active ads, each guest sees a random one.

Every ad shows **views**, **clicks** and the **click rate**, with views per day for the last 30 days. Videos are streamed in parts (HTTP range requests), so they start quickly on phones.

Tip: keep a splash video short (5 to 15 seconds) and under 5 MB; guests are on the Wi-Fi but not yet on the internet while the video loads from your server.

## API

All of this is in the customer API with the scope `marketing`: `/api/v1/marketing-settings`, `/marketing/contacts` (also `?format=csv`), `/marketing/sync`, `/marketing/forget`, `/marketing/privacy-requests`, `/survey-settings`, `/survey`, `/ads` and `/media/video` (send the raw file with `Content-Type: video/mp4` or `video/webm`).
