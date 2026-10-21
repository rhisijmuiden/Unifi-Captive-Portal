# Notifications, reports and e-mail templates

**English** · [Nederlands](../nl/notificaties-mail.md)

## Notifications

Under **Insights → Notifications** you choose which e-mails the platform sends you:

- **Hostname is live**: as soon as the A record of your hostname is validated and the SSL certificate is in place. Sent once per hostname.
- **Monthly report**: at the start of every month, the report of the previous month.

**Who receives them**: by default all customer administrators. Switch that off and/or add your own addresses, such as a manager or a shared mailbox. The log on the right shows every notification with its status; one that failed (for example because SMTP was down) is retried automatically.

Notifications are sent through the SMTP server of the platform, so the platform admin must have set up **E-mail (SMTP)** first.

## Monitoring: consoles and access points

The platform checks every connected console every 5 minutes. Under **Insights → Notifications → Monitoring** you choose:

- **Console offline**: an e-mail when a UniFi console cannot be reached (for example no internet or no power at that location). Guests there cannot sign in through the portal while it lasts.
- **Access point offline**: an e-mail when UniFi reports one of your access points as offline. Off by default.
- **Alert after**: how long an outage must last before you get the e-mail (5 minutes to 2 hours, default 10). Short blips are ignored.

When the console or access point works again you get a second e-mail with how long the outage lasted, but only if the first one was sent. Both e-mails go to the same recipients as the other notifications and are listed in the log. The platform admin can change their look under **E-mail templates** (*Console offline*, *Console back online*, *Access point offline*, *Access point back online*). The same moments are available as webhooks: `console.offline`, `console.online`, `device.offline` and `device.online`.

## Live dashboard

**Insights → Live** shows what is happening on your guest network right now and refreshes every 10 seconds:

- guests online now (per location), connections and unique devices today, compared with the same day last week, and the last hour
- today by hour as a bar chart, with the same weekday last week as a line for comparison (hover a bar for the numbers)
- how guests sign in today, and who is online per access point
- the latest sign-ins
- the state of every console and its access points, with a red banner as soon as something is offline

## Reports

**Insights → Reports** shows a month at a glance:

- guests connected, unique devices, e-mail registrations, vouchers used, payments and revenue, each compared with the month before
- guests per day and per hour, with the busiest day and hour
- guests per way of signing in, the number of marketing opt-ins and, with more than one site, guests per site

Use the arrows to browse months and **E-mail this report to me** to send it at once. Months follow the Europe/Amsterdam time zone (configurable with `TZ`).

## E-mail templates

Every e-mail the platform sends can be designed, visually or in HTML.

- **Customers** (under **Insights → Guest e-mails**) design the e-mails their guests and admins receive: *Welcome for guests*, *Payment receipt*, *Hostname is live* and *Monthly report*.
- **The platform admin** (under **System → E-mail templates**) designs the platform-wide versions of all e-mails, including invitations, password reset and the SMTP test. Customers without their own version get these.

Order: the customer's own version → the platform version → the built-in default. **Back to standard** removes your own version.

### Editing

- Choose the language at the top; every language has its own version.
- **Visual**: build the e-mail from blocks (heading, text, button, image, divider, spacing and, for reports, the data block) and set colours, logo, font and rounded corners.
- **HTML**: write your own HTML. **Fill with the visual design** turns the visual version into HTML as a starting point.
- **Placeholders**: click one to copy it, then paste it into a text, for example `{{name}}`. In HTML, `{{name}}` is always escaped; `{{{data}}}` inserts the ready-made table of a report.
- The preview on the right uses sample data; **Send test to me** sends it to your own address.

Every e-mail ends with "Designed by RHIS"; in HTML mode it is added when it is missing.

Designed by [RHIS](https://rhis.nl).
