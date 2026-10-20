# Billing customers

> 🇳🇱 [Nederlandse versie](../nl/facturatie.md)

As the platform admin you invoice your customers (tenants) for their guest portal from **Billing** in the main admin panel. This is separate from *paid guest access*: whether guests pay for Wi-Fi is something each customer switches on in their own environment (see [Guest access](guest-access.md)).

## 1. Set up your company details

**Billing → Settings**

| Setting | What it does |
| --- | --- |
| Company details | Name, address, e-mail, VAT and Chamber of Commerce (KvK) number, IBAN/BIC and logo (PNG, JPG or SVG). Printed on every invoice. Invoices can only be issued once the company name is filled in. |
| Currency, default VAT rate | Default 21%. Each customer can have their own rate (9%, 0%) or **VAT reverse-charged** for EU business customers. |
| Payment term | Due date = invoice date + this many days (default 14). |
| Invoice number | Prefix plus a sequence without gaps. `{year}` becomes the year, so `{year}-` with 4 digits gives `2026-0001`, `2026-0002`, … and restarts in 2027. |
| Footer | Small print on every page, for example your terms. |
| Send subscription invoices automatically | On: new invoices are issued and e-mailed immediately. Off: they wait as drafts for you to check and send. |
| Reminders | E-mail reminders a number of days after the due date, for example `7, 14`. |
| Pause portals automatically | When an invoice is overdue longer than the number of days you set, guests of that customer can no longer connect. The customer can still sign in and pay; the portal resumes by itself as soon as nothing is overdue anymore. |
| Online payment | Your own Mollie or Stripe account (not the customer's). |

Invoices and reminders are e-mailed through the platform's SMTP server, so set up **E-mail (SMTP)** first.

### Online payment with Mollie or Stripe

- **Mollie**: enter the API key (`test_…` to try it out, `live_…` for real payments). Mollie reports payments to `https://<admin-hostname>/billing/webhooks/mollie` automatically.
- **Stripe**: enter the secret key and create a webhook in the Stripe dashboard (Developers → Webhooks) for `https://<admin-hostname>/billing/webhooks/stripe` with the events `checkout.session.completed` and `checkout.session.expired`, then paste the signing secret (`whsec_…`).

Use **Test connection** to check the key. Webhooks only reach a public address, so give the admin panel its own hostname under **Hosting & SSL**. Without webhooks the platform still checks open payments every minute.

## 2. Plans

**Billing → Plans** holds the prices you offer, for example *Basic* €19.95 a month and *Pro* €49.95 a month (excluding VAT). Plans are a starting point: choosing one for a customer fills in the name, price and period, which you can still change per customer. Changing a plan later does not change existing subscriptions.

## 3. Subscriptions per customer

**Billing → Subscriptions → ✏️** (or the 🧾 button next to a customer under **Customers**)

- **Invoice details**: company name, address, invoice e-mail (empty = the customer's contact address, then its admins), VAT number, their reference (for example a purchase order number), language of invoices and e-mails (English or Dutch), VAT rate or reverse charge.
- **Subscription**: plan, name on the invoice, price excl. VAT, period (monthly, quarterly, yearly) and start date.

Invoices are made **in advance**: the first invoice covers the period from the start date, the next one starts the day after. A start date in the past also invoices the periods since then. After the first invoice you can move **Next invoice** to skip or repeat a period. Pausing a subscription and switching it back on never invoices the paused time.

The billing job runs every hour (and shortly after a restart). Dates follow the time zone Europe/Amsterdam (`TZ`).

## 4. Invoices

**Billing → Invoices** shows the outstanding amount, what is overdue, what was received this month and the recurring revenue per month.

| Action | When |
| --- | --- |
| **New invoice** | One-off amounts, for example installation. Saved as a draft, or issued and sent at once. |
| ✏️ / 🗑 | Drafts only. |
| **Issue and send** | Gives the draft the next number and the invoice and due date, freezes your company and customer details on it, and e-mails it with the PDF attached. |
| **Send again / Send reminder** | E-mails the invoice (or a reminder when it is overdue) again. |
| **Copy pay link** | The link from the e-mail, for example to send through another channel. |
| **Mark as paid** | For a bank transfer; optionally sends a payment confirmation. |
| **Cancel invoice** | An issued invoice cannot be changed or deleted (it has to stay in your records); cancel it and create a new one instead. The number stays used. |

Invoices are kept when a customer is deleted.

### What the customer sees

- The e-mail with the invoice as PDF and a **Pay online now** button. The pay link opens a page with the amount, a pay button and the PDF; after paying, the invoice is marked paid automatically and the customer gets a confirmation.
- In their own environment, under **Invoices** (customer admins only): what is due, their subscription, all invoices with the PDF and a **Pay** button, and a notice when the portal is paused.

The look of the e-mails *Invoice*, *Payment reminder* and *Payment received* can be changed under **E-mail templates**.
