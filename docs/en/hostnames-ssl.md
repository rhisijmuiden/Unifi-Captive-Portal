# Hostnames and SSL

**English** · [Nederlands](../nl/hostnamen-ssl.md)

Every customer can run their guest portal on their own hostname, such as `guest.company.com`, and the platform admin can put the admin panel on its own hostname, such as `portal.yourcompany.com`. Both get a free Let's Encrypt certificate automatically.

## How it works

- **Caddy** runs on ports 80 and 443 on the server and forwards everything to the application on port 8080. The installer sets it up.
- Caddy asks the application before it requests a certificate. The application only says yes for hostnames that are registered here **and** whose DNS record points at this server. Nobody can make the server request certificates for random names.
- Certificates renew automatically, well before they expire.

## For the platform admin: first setup

1. Make sure ports **80 and 443** of the server are reachable from the internet (port forward or firewall rule to the server or LXC).
2. In the admin panel, open **System → Hosting & SSL**.
3. Fill in the **public IPv4 address** (or click **Detect automatically**). Only fill in IPv6 when the server is really reachable over IPv6: Let's Encrypt prefers IPv6 when an AAAA record exists.
4. Optional: fill in an **admin panel hostname**, create its A record, and click **Save and check**. Once the status is *Active with SSL*, open the panel through `https://<hostname>`. With **Always use HTTPS** on, visitors on `http://` are redirected.
5. Using Microsoft SSO? Add the new redirect URL (`https://<hostname>/api/auth/entra/callback`, shown under **Single sign-on**) to the app registration in Entra.

Links in e-mails (invitations, password reset) and the SSO redirect use the admin hostname as soon as it is set.

To receive Let's Encrypt expiry notices, set an e-mail address once:

```bash
CP_ACME_EMAIL=you@company.com bash /opt/captive-portal/install/caddy.sh
```

## For customers: your own hostname

1. Open **Hostnames & SSL** and add the hostname, for example `guest.company.com`.
2. At your domain provider, create the record shown on the page:

   | Type | Name | Value |
   | --- | --- | --- |
   | A | guest.company.com | the platform IP address |

   Do not use a proxy (such as the orange cloud in Cloudflare): the record must point straight at the platform.
3. The platform checks the record every five minutes, or right away when you click **Check now**. When it is correct, the certificate is requested and the status becomes **Active with SSL**, usually within minutes.
4. Add the hostname to the **Pre-Authorization Allowances** in UniFi (see [Connecting a UniFi console](unifi-setup.md)).

From then on guests are sent to `https://guest.company.com`. Without an active hostname the portal works over the platform IP address, without a padlock.

## Statuses and messages

| Status | Meaning |
| --- | --- |
| Waiting for check | Just added; the first check runs within seconds |
| DNS correct, requesting certificate | The record is right; Caddy is getting the certificate |
| Active with SSL | Done |
| Action needed | See the message below the hostname |

| Message | What to do |
| --- | --- |
| No A or AAAA record was found yet | Create the record. A new record can take up to a few hours to become visible. |
| The record points to … instead of this server | Correct the value, or remove an old AAAA record. |
| The certificate has not been issued yet | Usually temporary (for example Let's Encrypt rate limits). The platform retries automatically. Check that ports 80 and 443 are open. |
| The SSL service (Caddy) does not respond | Platform admin: see [When Caddy does not respond](#when-caddy-does-not-respond). |

## When Caddy does not respond

The **SSL service (Caddy)** card under **Hosting & SSL** shows whether Caddy listens on ports 443 and 80 and whether it runs this app's configuration. When something is red, run as root on the server:

```bash
systemctl status caddy --no-pager        # is Caddy running?
journalctl -u caddy -n 50 --no-pager     # why did it stop?
ss -ltnp | grep -E ':(80|443) '          # who listens on 80/443?
bash /opt/captive-portal/install/caddy.sh  # install or repair Caddy
```

The repair script installs Caddy when it is missing, writes the configuration, refuses to start when another web server (such as Apache or nginx) holds port 80 or 443, and shows Caddy's log when it does not come up. On an LXC container, ports 80 and 443 must also be forwarded to the container.

## Your own reverse proxy instead of Caddy

Install with `CP_CADDY=0` and forward ports 80 and 443 to `127.0.0.1:8080` yourself. Forward the `X-Forwarded-For`, `X-Forwarded-Proto` and `Host` headers, and only from the same machine (the app trusts proxy headers from `127.0.0.1` only). You then manage the certificates yourself; the hostname check will show *The SSL service does not respond* unless your proxy listens on port 443 of the same machine.
