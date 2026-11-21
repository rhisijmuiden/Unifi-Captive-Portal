# Installation

> 🇳🇱 [Nederlandse versie](../nl/installatie.md)

Captive Portal runs on **Debian 13 (Trixie)**: as a Proxmox container (LXC), on a VM or on a physical server. There are three ways to install it; all three end the same way. The console shows **only the web address, the username and a generated password**, and you configure everything else in the web interface.

```
------------------------------------------------------------
  Captive Portal 1.0.1 (RHIS)
------------------------------------------------------------

  Web interface : http://192.168.1.50:8080
  Username      : admin
  Password      : aYvjk-CaYUv-m7Cd3-jFn7Q

  Sign in and choose your own password; all further
  configuration happens in the web interface.
------------------------------------------------------------
```

## Requirements

| | Minimum | Recommended |
| --- | --- | --- |
| CPU | 1 core | 2 cores |
| Memory | 1 GB | 2 GB (building during installs and updates uses the most) |
| Disk | 4 GB | 8 GB or more, depending on backups |
| Network | Outbound HTTPS to GitHub, NodeSource and Debian | Fixed IP address |

## Option 1: Proxmox CT template (recommended for Proxmox)

Every release comes with a ready-made **CT template**: Debian 13 with Captive Portal already installed. You download it in Proxmox itself and make a container from it; there is nothing to type in a shell.

**1. Download the template**

1. In the Proxmox web interface, open your storage for templates (usually **local**) and go to **CT Templates**.
2. Click **Download from URL** and paste:

   | Version | URL |
   | --- | --- |
   | Newest **stable** version | `https://github.com/rhisijmuiden/Unifi-Captive-Portal/releases/latest/download/captive-portal-debian-13-amd64.tar.zst` |
   | A specific (e.g. **test**) version | `https://github.com/rhisijmuiden/Unifi-Captive-Portal/releases/download/v1.0.1-beta.5/captive-portal-debian-13-amd64.tar.zst` (replace the version) |

3. Click **Query URL**. You may change the file name, for example to `captive-portal-1.0.1-debian-13-amd64.tar.zst`, so you can tell versions apart later.
4. Optional but recommended: choose hash algorithm **SHA-256** and paste the checksum from the `.sha256` file next to the template on the [releases page](https://github.com/rhisijmuiden/Unifi-Captive-Portal/releases).
5. Click **Download**.

**2. Create the container**

1. Click **Create CT** (top right).
2. **General**: hostname (e.g. `captive-portal`), a root password, leave **Unprivileged container** and **Nesting** on.
3. **Template**: pick the Captive Portal template you downloaded.
4. **Disk** 8 GB, **CPU** 2 cores, **Memory** 2048 MB.
5. **Network**: DHCP or a fixed IP address (recommended, since UniFi consoles and DNS records point to it).
6. Tick **Start after created** and click **Finish**.

**3. Open the console**

On its first start the container sets itself up: its own secret keys and database password, the database, HTTPS (Caddy) and the main administrator. That takes about a minute and needs no internet. Then the container's **Console** shows the web address, username and password as above. If the console still says the setup is running, press Enter to refresh.

Prefer the command line on the Proxmox host? This does the same:

```bash
pvesh create /nodes/$(hostname)/storage/local/download-url --content vztmpl \
  --filename captive-portal-debian-13-amd64.tar.zst \
  --url https://github.com/rhisijmuiden/Unifi-Captive-Portal/releases/latest/download/captive-portal-debian-13-amd64.tar.zst
pct create 120 local:vztmpl/captive-portal-debian-13-amd64.tar.zst --hostname captive-portal \
  --cores 2 --memory 2048 --rootfs local-lvm:8 --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1 --features nesting=1 --start 1
pct exec 120 -- captive-portal-admin     # web address and login details
```

> **Why "Download from URL" and not the list under Templates?** The **Templates** button in Proxmox only lists the templates of Proxmox and TurnKey Linux; you cannot add your own source to it. **Download from URL** in the same CT Templates screen is the supported way for any other template.

## Option 2: Proxmox helper script

Run this in the shell of your **Proxmox host**:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main/ct/captive-portal.sh)"
```

The script uses the same engine as the [community-scripts Debian script](https://github.com/community-scripts/ProxmoxVE/blob/main/ct/debian.sh), with the same menus (default or advanced: ID, storage, network, VLAN). It creates an unprivileged Debian 13 container with 2 cores, 2 GB RAM and 8 GB disk, installs Captive Portal inside it and ends with the web address and login details.

## Option 3: bare Debian 13 (physical server, VM or container)

Install a minimal Debian 13 (no desktop; in the installer only *SSH server* and *standard system utilities*), sign in as root and run:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main/install/install.sh)"
```

A minimal Debian has no `curl`; use `wget` then:

```bash
bash -c "$(wget -qO- https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main/install/install.sh)"
```

This works the same in an LXC container (Proxmox, Incus/LXD) or systemd-nspawn. The machine needs **systemd**, so plain Docker containers are not supported; for those there is a Dockerfile, see [Development](development.md).

The installer shows one line per step and keeps the details in `/var/log/captive-portal-install.log`:

1. installs PostgreSQL, Node.js 24 LTS (NodeSource), git and helper tools;
2. fetches the newest stable version into `/opt/captive-portal` and builds it;
3. creates a database with a random password and secret key;
4. installs and starts the services;
5. installs **Caddy** on ports 80 and 443 for HTTPS with automatic Let's Encrypt certificates (see [hostnames-ssl.md](hostnames-ssl.md));
6. creates the main administrator with a generated password;
7. clears the screen and shows only the web address and the login details.

You can safely run the installer again; existing settings, data and accounts are kept.

In a container without *nesting*, systemd cannot sandbox the service. The installer notices and starts it without that extra protection (`/etc/systemd/system/captive-portal.service.d/50-container.conf`); turn nesting on and delete that file to get it back.

### Options

| Variable | Meaning | Default |
| --- | --- | --- |
| `CP_REF` | Version (tag) or branch to install, e.g. `v1.0.1` | newest stable release, otherwise `main` |
| `CP_CHANNEL` | `test` = newest version including test versions (without `CP_REF`) | `stable` |
| `CP_REPO_URL` | Git repository to install from: a fork, or a local git bundle (see [Development](development.md#testing-an-unpublished-build)) | this project on GitHub |
| `CP_PUBLIC_URL` | Address where the admin interface is reachable | `http://<server-ip>:8080` |
| `CP_NODE_MAJOR` | Node.js major version | `24` |
| `CP_ACME_EMAIL` | E-mail address for Let's Encrypt expiry notices | empty |
| `CP_CADDY` | `0` = do not install Caddy (when you run your own reverse proxy) | `1` |
| `CP_KEEP_SCREEN` | `1` = do not clear the screen before the login details | `0` |

Example: `CP_CHANNEL=test bash -c "$(curl -fsSL …/install/install.sh)"`

## First sign-in

1. Open the web address from the console and sign in with username `admin` and the password shown.
2. Enter your **name** and **e-mail address** and choose your own password. From then on you sign in with that e-mail address, and the console no longer shows the password.
3. The **Getting started** list on the overview takes you through the rest:
   - **System → E-mail (SMTP)**: your mail server, so invitations and password resets work. See [smtp.md](smtp.md).
   - **System → Single sign-on**: optionally Microsoft Entra. See [entra-sso.md](entra-sso.md).
   - **System → Hosting & SSL**: the public IP address and optionally an HTTPS hostname for the admin panel. See [hostnames-ssl.md](hostnames-ssl.md).
   - **Customers**: your first customer with a customer admin (invite by e-mail or generate login details, see [security.md](security.md#login-details-for-new-users)). The customer connects their console as described in [unifi-setup.md](unifi-setup.md).

Ports: **8080** (admin panel, also directly), **80** and **443** (Caddy: guest portals and HTTPS). Forward 80 and 443 from the internet to the server.

The interface follows the browser language; each user can change it at the bottom of the menu or under **My account**.

### Lost the admin password?

Sign in on the server console (or over SSH) as root and run:

```bash
captive-portal-admin                          # web address, plus the login details while the generated password is unchanged
captive-portal-admin reset-password           # new generated password for the first main administrator
captive-portal-admin reset-password you@example.com
```

The new password appears on the console and must be changed at the next sign-in.

## Files and services

| Path | Contents |
| --- | --- |
| `/opt/captive-portal` | Application (git checkout of a release) |
| `/etc/captive-portal/captive-portal.env` | Configuration: database, secret key, public URL |
| `/var/lib/captive-portal` | Data: update status, backups, console banner |
| `/var/log/captive-portal-install.log` | Installer log |
| `/var/log/captive-portal-update.log` | Update log |
| `/etc/caddy/Caddyfile` | Caddy configuration (managed by the installer) |
| `/etc/captive-portal/caddy.env` | E-mail address for Let's Encrypt |

```bash
systemctl status captive-portal          # is the app running?
journalctl -u captive-portal -f          # live log
systemctl restart captive-portal         # restart after changing the configuration
journalctl -u captive-portal-firstboot   # first start of a container made from the template
```

If you change `PUBLIC_URL` (for example because you move to a domain name with HTTPS), also update the redirect URI in your Entra app registration.

> **Note:** keep `APP_SECRET` from the configuration file safe. Stored passwords (SMTP, SSO) are encrypted with it; without that key they cannot be read after a restore.

## How the template is made

The release workflow builds the template on GitHub for every new version (`ct/build-template.sh`): it starts from Proxmox's own `debian-13-standard` template (checked against Proxmox's SHA-512), runs the installer in build mode (software only, no secrets) and packs the result. A container made from it runs `captive-portal-firstboot.service` once, which runs the same installer in configure mode. Updates afterwards go through **Info & updates** like any other installation.

To make a template for an existing release yourself: **Actions → Release → Run workflow** with the tag, or on any Linux machine with root: `sudo ct/build-template.sh --ref v1.0.1`.
