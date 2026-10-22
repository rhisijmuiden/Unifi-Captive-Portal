# White-label resellers

**English** · [Nederlands](../nl/resellers.md)

A reseller is a partner who sells the captive portal platform to its own customers under its own brand. The reseller manages those customers itself, in an admin panel with its own logo, colour and (optionally) its own address. You, the platform admin, decide per reseller how many customers it may have and which RHIS mentions stay visible.

## Who does what

| | Platform admin | Reseller admin | Customer (of a reseller) |
|---|---|---|---|
| Create, change and suspend resellers | ✅ | | |
| RHIS mentions, customer limit, admin address | ✅ | | |
| Logo, colour, brand name, website, support e-mail | ✅ | ✅ | |
| Create, change, suspend and delete its own customers | ✅ | ✅ | |
| Invite colleagues and the customers' first admins | ✅ | ✅ | |
| Consoles, portal, guests, vouchers and so on | | | ✅ |
| Server settings, SMTP, backups, updates, billing | ✅ | | |

Like the platform admin, a reseller only manages customers. It does not see their consoles, portals or guests: those stay in the customer's own environment.

## Adding a reseller

1. Go to **Management → Resellers** and click **New reseller**.
2. Fill in the company name; the short name (slug) and the brand name follow automatically.
3. Optional:
   - **Maximum number of customers**: leave empty for unlimited. When the limit is reached, the reseller sees *You have reached your limit* and asks you to raise it.
   - **Own admin address**, for example `wifi.partner.com` (see below).
   - **Branding**: logo for light backgrounds, logo for the dark menu, accent colour, website and support e-mail. The reseller can change these later under **Branding**.
4. Under **RHIS mentions** choose what stays visible:
   - **Show "Powered by RHIS"** (default on): the card at the bottom of the menu and the line under **Info**.
   - **Show "Designed by RHIS"** (default off): bottom right in the admin panel, in the footer of the customers' guest portals and in their e-mails.
5. Under **First admin** fill in a name and e-mail address, and choose **Let them set a password** (an e-mail invitation) or **Generate login details** (shown once, with a ready-made message for WhatsApp; see [login details](security.md#login-details-for-new-users)). That person can then invite colleagues under **Team**.

## The reseller's admin panel

After signing in, the reseller sees its own brand and a short menu:

- **Overview**: number of customers, users, guests today and consoles of its own customers, and their recent activity.
- **Customers**: create customers (with a first admin), change, suspend or delete them. With a limit, the page shows *3 of 10 customers*.
- **Team**: its own colleagues (role *Reseller admin*) and, by choosing a customer, that customer's team.
- **Branding**: name, logos, accent colour, website and support e-mail, with a preview.

The reseller's customers see the same brand in their admin panel: the logo in the menu, the accent colour on buttons and links, the brand name in the browser tab and the support e-mail under **Info** and on the sign-in page. Invitation and password e-mails link to the reseller's own address when it has one.

## Own admin address

With an own address, the reseller and its customers sign in at, for example, `https://wifi.partner.com` and see the reseller's brand before signing in as well.

1. Have the reseller create a DNS record: an **A** record (and **AAAA** for IPv6) for `wifi.partner.com` pointing to the public IP address of this server. A **CNAME** to the platform's own address works too.
2. Fill in the address under **Own admin address** for the reseller.
3. Open the address. Caddy requests a Let's Encrypt certificate automatically on the first visit.

The address cannot also be used as a customer's portal hostname or as the platform's own address.

**Microsoft (Entra) SSO** signs in through the platform's own address, because that is the redirect address registered in Entra. On a reseller's address, the **Sign in with Microsoft** button therefore continues on the platform address; after signing in, the reseller's brand is shown as usual.

## Assigning an existing customer

Open **Management → Customers**, edit the customer and choose the reseller under **Reseller**. **None (direct with RHIS)** moves it back to you. Only the platform admin can move customers between resellers.

## Suspending and deleting

- **Suspended** closes the admin panel right away for the reseller's team and for all its customers (open sessions end, signing in shows *This account is suspended*, API keys of those customers stop working). Guest portals and Wi-Fi access keep working.
- **Deleting** a reseller is only possible once it has no customers left (move or delete them first). Its team is deleted with it.

## API

The platform API has a scope **resellers** (`GET/POST/PUT/DELETE /api/v1/resellers`), with the same fields as the form, including `showPoweredBy`, `showDesignedBy`, `maxTenants` and an optional `admin` to invite. With `resellerId` on `POST/PUT /api/v1/tenants` you assign a customer to a reseller. See [API and webhooks](api.md).
