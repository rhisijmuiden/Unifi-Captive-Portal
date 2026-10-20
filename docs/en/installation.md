# Installation

> 🇳🇱 [Nederlandse versie](../nl/installatie.md)

Captive Portal runs on **Debian 13 (Trixie)**, as a Proxmox LXC or on a VM or physical server. The web interface listens on **port 8080**.

## Requirements

| | Minimum | Recommended |
| --- | --- | --- |
| CPU | 1 core | 2 cores |
| Memory | 1 GB | 2 GB (building during installs and updates uses the most) |
| Disk | 4 GB | 8 GB or more, depending on backups |
| Network | Outbound HTTPS to GitHub, NodeSource and Debian | Fixed IP address |

## Option 1: Proxmox LXC

Run this in the shell of your **Proxmox host**:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main/ct/captive-portal.sh)"
```

The script uses the same engine as the [community-scripts Debian script](https://github.com/community-scripts/ProxmoxVE/blob/main/ct/debian.sh), so you get the same menus (default or advanced: ID, storage, network, VLAN). By default it creates an unprivileged Debian 13 container with 2 cores, 2 GB RAM and 8 GB disk, and installs Captive Portal inside it.

To update the container later, run the same command again **inside the container**, or use **Info & updates** in the web interface.

## Option 2: Debian 13 VM or physical server

Install a minimal Debian 13 (no desktop), sign in as root (or use `sudo -i`) and run:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main/install/install.sh)"
```

The installer:

1. installs PostgreSQL, Node.js 24 LTS (NodeSource), git and helper tools;
2. fetches the latest version into `/opt/captive-portal`;
3. creates a database with a random password and secret key;
4. builds the application and runs database migrations;
5. installs the systemd services `captive-portal` and `captive-portal-updater.path`;
6. installs **Caddy** on ports 80 and 443 for HTTPS with automatic Let's Encrypt certificates (see [hostnames-ssl.md](hostnames-ssl.md));
7. checks that the web interface responds.

You can safely run the installer again; existing settings and data are kept.

### Options

| Variable | Meaning | Default |
| --- | --- | --- |
| `CP_REF` | Version (tag) or branch to install, e.g. `v0.1.0` | latest release, otherwise `main` |
| `CP_PUBLIC_URL` | Address where the admin interface is reachable | `http://<server-ip>:8080` |
| `CP_NODE_MAJOR` | Node.js major version | `24` |
| `CP_ACME_EMAIL` | E-mail address for Let's Encrypt expiry notices | empty |
| `CP_CADDY` | `0` = do not install Caddy (when you run your own reverse proxy) | `1` |

Example: `CP_PUBLIC_URL=https://portal.example.com bash -c "$(curl -fsSL …/install/install.sh)"`

## First start

1. Open `http://<server-ip>:8080`.
2. Create the first **platform admin** account.
3. Set up your mail server under **System → E-mail (SMTP)**, so invitations and password resets work. See [smtp.md](smtp.md).
4. Optional: turn on Microsoft Entra under **System → Single sign-on**. See [entra-sso.md](entra-sso.md).
5. Under **System → Hosting & SSL**, set the public IP address and, optionally, an HTTPS hostname for the admin panel. See [hostnames-ssl.md](hostnames-ssl.md).
6. Add your first customer under **Customers** and invite a customer admin. The customer connects their console as described in [unifi-setup.md](unifi-setup.md).

Ports: **8080** (admin panel, also directly), **80** and **443** (Caddy: guest portals and HTTPS). Forward 80 and 443 from the internet to the server.

The interface follows the browser language; each user can change it at the bottom of the menu or under **My account**.

## Files and services

| Path | Contents |
| --- | --- |
| `/opt/captive-portal` | Application (git checkout of a release) |
| `/etc/captive-portal/captive-portal.env` | Configuration: database, secret key, public URL |
| `/var/lib/captive-portal` | Data: update status, backups |
| `/var/log/captive-portal-update.log` | Update log |
| `/etc/caddy/Caddyfile` | Caddy configuration (managed by the installer) |
| `/etc/captive-portal/caddy.env` | E-mail address for Let's Encrypt |

```bash
systemctl status captive-portal          # is the app running?
journalctl -u captive-portal -f          # live log
systemctl restart captive-portal         # restart after changing the configuration
```

If you change `PUBLIC_URL` (for example because you move to a domain name with HTTPS), also update the redirect URI in your Entra app registration.

> **Note:** keep `APP_SECRET` from the configuration file safe. Stored passwords (SMTP, SSO) are encrypted with it; without that key they cannot be read after a restore.
