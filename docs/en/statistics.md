# Platform statistics

**English** · [Nederlands](../nl/statistieken.md)

As platform admin you see under **Statistics** (left menu, right below Overview) how the whole platform is used: how many guests signed in, through which resellers and customers, at which moments of the day, and how that changes over time. You can download every view as a CSV file or a PDF report.

The page only shows **figures**. You cannot open or change a customer's consoles, portals or guests from here; that stays in the customer's own environment. Resellers and customers do not see this page; customers have their own **Reports** page with their monthly report.

## Filters

All filters sit in one bar at the top and are kept in the address, so you can bookmark or share a view.

| Filter | What it does |
|---|---|
| **Period** | 7 days, 30 days (default), 90 days, 12 months, this year, or **Custom** with your own start and end date (at most three years). |
| **Reseller** | All resellers, only **direct customers** (customers without a reseller), or one reseller. |
| **Customer** | One customer. The list only shows the customers of the chosen reseller. |
| **Bars per** | Day, week or month. **Auto** picks days up to two months, weeks up to half a year, and months beyond that. |

Clicking a reseller in **Per reseller** or a customer in **Per customer** sets that filter. **Clear filters** brings you back to the last 30 days of all customers.

## What you see

| Part | Meaning |
|---|---|
| **Guest sign-ins** | Every successful sign-in of a guest on a portal in the period. A guest who signs in twice counts twice. |
| **Unique devices** | Different devices (MAC address per customer) that signed in. |
| **Active customers** | Customers with at least one guest sign-in in the period, out of all customers in the selection. |
| **Guests online now** | Guests whose access has not yet ended, right now and regardless of the period. |
| **Registrations** | Different e-mail addresses that registered through the e-mail sign-in. |
| **New devices / returning** | Devices that signed in for the first time in this period, and devices that had been seen before. |
| **New customers** | Customers created in the period. |
| **Admins signed in** | Admin users (platform, reseller and customer) who signed in to the admin panel in the period. |
| **Vouchers used / paid sign-ins / guest payments** | Sign-ins with a voucher or a payment, and the amount guests paid to customers through Mollie or Stripe. This is not your own billing; that is under **Billing**. |

Every main figure shows the change against the **previous period**: the same number of days directly before the chosen period.

- **Over time**: a line of guest sign-ins (or unique devices, or active customers) per day, week or month, with the previous period as a dashed line. Hover over the chart to see the exact numbers.
- **Busy moments**: a heatmap of sign-ins per weekday and hour, with totals per hour above it and per weekday on the right. The darker the cell, the busier. The busiest hour is named above the chart. Times are in the server's time zone (Europe/Amsterdam unless `TZ` is set differently).
- **Per reseller**: the share of each reseller (and of your direct customers) in the sign-ins, how many of their customers were active, and the change against the previous period.
- **Sign-in methods**: how guests signed in (free, e-mail, voucher, payment, SMS, hotel room, social logins).
- **Per customer**: a table with every customer, sortable on each column and searchable, with guests, devices, registrations, change and the last sign-in.

## Exporting

- **CSV**: all figures of the current view (summary, the series over time, the weekday × hour grid, per reseller, per customer and per sign-in method) in one file, one section below the other. In Dutch the file uses semicolons, so Excel opens it straight into columns.
- **PDF report**: an A4 report in the interface language with the headline figures, a bar chart over time, the heatmap and the tables. Handy to send to management or a reseller.

Both downloads follow the filters you set.

## Through the API

With a platform API key that has the **Platform statistics** scope (`statistics:read`) you can fetch the same figures:

- `GET /api/v1/platform/stats?from=2026-10-01&to=2026-10-31&reseller=<id or direct>&tenant=<id>&granularity=day|week|month`
- `GET /api/v1/platform/stats/export?format=csv|pdf&lang=en|nl` with the same filters

See [API and webhooks](api.md).
