# API and webhooks

> 🇳🇱 [Nederlandse versie](../nl/api.md)

Everything you can do in the web interface can also be done through the REST API, so other systems (a hotel system, CRM, monitoring, your own website) can be linked. There are two APIs:

| | Who | What |
| --- | --- | --- |
| **Customer API** | customer admins, under **API** in their own environment | consoles, hostnames, portal settings and design, guests, vouchers, hotel stays, SMS and social login settings, payments and packages, notifications and guest e-mails, reports, team members and their own invoices |
| **Platform API** | the platform admin, under **System → API** | customers (create, change, suspend, delete, with a first admin), users, server settings (SMTP, SSO, hosting, billing settings), platform e-mail templates, billing, backups and updates |

The two never overlap: a customer key cannot see other customers or server settings, and a platform key cannot reach the portals of customers. That follows the same split as the web interface.

## In short

- Address: `https://<admin hostname>/api/v1/…` (shown on the API page with a copy button).
- Sign in with an **API key** in the header: `Authorization: Bearer cpk_…`.
- Every key has **scopes** per part, read or write (write includes read), an optional **expiry date** and a **rate limit** per minute.
- Every request with a key is kept for 90 days in the key's **audit trail**; changes made through the API also appear in the activity log with the key.
- **Webhooks** send a signed message to your system as soon as something happens.
- The **documentation** tab describes every operation in English and Dutch and lets you try it out. The OpenAPI 3.1 description is available at `/api/v1/openapi.json` for Postman, Insomnia or code generators.

## 1. Create a key

1. Open **API** in the menu (customers) or **System → API** (platform admin) and click **New API key**.
2. Give it a name that says what it is for, such as "Hotel PMS".
3. Choose the **scopes**: per part *None*, *Read* or *Write*. Give a key only what it needs.
4. Choose when it **expires**: in 30 days, 90 days, a year, on a date, or never.
5. Set the **requests per minute** (default 120).
6. Click **Create key** and **copy the key right away**. It is shown only once; after that only the first characters (`cpk_xxxxxxxx…`) are visible.

Change the name, scopes, limit or expiry date later with the pencil. **Revoke** stops a key at once (it stays in the list with its audit trail); **Delete** removes it with its audit trail.

A customer key acts as a customer admin of that customer; a platform key acts as a platform admin. Within that, the scopes decide what the key may do. A key stops working when it expires, is revoked, or when its customer is suspended.

## 2. Make a request

```bash
curl https://portal.example.com/api/v1/vouchers \
  -H "Authorization: Bearer cpk_…"

curl -X POST https://portal.example.com/api/v1/vouchers \
  -H "Authorization: Bearer cpk_…" \
  -H "Content-Type: application/json" \
  -d '{"count": 10, "durationMinutes": 1440, "batch": "Reception"}'
```

Platform example: create a customer with a first admin, who gets the invitation e-mail right away:

```bash
curl -X POST https://portal.example.com/api/v1/tenants \
  -H "Authorization: Bearer cpk_…" \
  -H "Content-Type: application/json" \
  -d '{"name": "Hotel De Haven", "slug": "hotel-de-haven", "admin": {"name": "Anna", "email": "anna@dehaven.nl"}}'
```

Answers are JSON. Errors look like `{"error": "…"}`:

| Status | Meaning |
| --- | --- |
| 400 | Invalid input; the message says which field |
| 401 | Missing, unknown, expired or revoked key |
| 403 | The key does not have the scope; the message names it, e.g. `vouchers:write` |
| 404 | Not found, or the operation is not part of the API |
| 429 | Rate limit reached; wait the number of seconds in `Retry-After` |

Error messages are in English by default; send `Accept-Language: nl` or `X-Locale: nl` for Dutch.

Every answer carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (seconds until the minute starts over).

## 3. Documentation and explorer

The **Documentation** tab lists every operation per part, with its scope, parameters and request body. Open an operation, paste a key and click **Send request** to try it; the key is only used on that page and is not stored. Each operation also shows the matching cURL command. Note that write operations really change data.

**OpenAPI (EN)** and **OpenAPI (NL)** download the description. It is also public at:

- `/api/v1/openapi.json?audience=tenant&lang=en` (customer API)
- `/api/v1/openapi.json?audience=platform&lang=nl` (platform API)

## 4. Webhooks

On the **Webhooks** tab, click **New webhook**, enter the address and choose the events. You get a **signing secret** (`whsec_…`); you can show it again later or replace it with a new one.

Customer events: `guest.authorized`, `payment.paid`, `hostname.active`, `console.offline`, `console.online`, `device.offline`, `device.online`, `invoice.issued`, `invoice.paid`.
Platform events: `tenant.created`, `tenant.updated`, `tenant.deleted`, `invoice.issued`, `invoice.paid`, `backup.succeeded`, `backup.failed`.

Every event is a `POST` with JSON:

```http
POST /your/address
Content-Type: application/json
X-Webhook-Id: 0b6f…
X-Webhook-Event: guest.authorized
X-Webhook-Timestamp: 1792540000
X-Webhook-Signature: v1=5d41402abc4b2a76b9719d911017c592…

{"id":"0b6f…","event":"guest.authorized","createdAt":"2026-10-21T09:00:00.000Z","tenantId":"…","data":{…}}
```

**Check the signature** before trusting a message: compute HMAC-SHA256 with the secret over `<X-Webhook-Timestamp>.<raw body>` and compare it in hex with the part after `v1=`. Refuse messages with a timestamp older than five minutes. A Node.js example is shown on the page after you create a webhook.

Answer with any `2xx` status within 10 seconds. Otherwise the delivery is retried after 1, 5 and 30 minutes, then 2, 6 and 24 hours. After 50 failed attempts in a row the webhook is switched off; switch it back on once your address works again. **Test** sends a `ping` event right away; **Deliveries** shows the last 100 deliveries with the answer of your system, and **Send again** retries one.

Customer webhooks must use `https://` and a public address; addresses on a private or local network are refused, also when a domain name resolves to one. Platform webhooks may use `http://` and your own network, for example for internal monitoring.

## What is not in the API

- Signing in, passwords and accounts, and managing API keys and webhooks themselves (only in the web interface).
- **Restoring a backup**: it replaces the whole database, so it stays in the web interface. Making backups and managing locations can be done through the API.
- Test e-mails that go to the signed-in user (template test, report preview).
