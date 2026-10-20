# Backups and restore

> 🇳🇱 [Nederlandse versie](../nl/backups.md)

The platform admin backs up the **whole platform** under **System → Backups**: the complete database (customers, users, consoles, portals, guests, payments, invoices, settings and e-mail templates) and the data folder (`/var/lib/captive-portal`). Customers do not see this page.

## In short

- **Full and incremental backups.** A full backup stores everything. An incremental backup only sends what changed since the previous backup: per database table and per file. Restoring an incremental backup always gives the complete state of that moment.
- **Locations**: **SCP** (SSH, recommended), **FTPS** (FTP with TLS 1.2 or newer, explicit or implicit), plain **FTP**, or a **local folder** on the server as an extra copy.
- **Encrypted** with AES-256-GCM using your own passphrase before anything leaves the server. The backup server never sees readable data.
- **Schedule per location**: a full backup every day, week or month at a set hour, with incremental backups every hour, 6 hours, 12 hours or day in between. **Retention**: keep the newest *n* full backups; older ones, with their incrementals, are removed automatically.
- **Restore** from the remote location, from the web interface, with a safety copy and automatic rollback.
- **E-mail on failure** to the platform admins (needs SMTP). The template *Backup failed* can be changed under E-mail templates.

## 1. Set the passphrase

On the right of the Backups page, enter a passphrase of at least 12 characters twice and click **Save passphrase**.

> ⚠️ **Store the passphrase in a password manager.** Without it no backup can be restored, not even by RHIS. A new passphrase starts a new full backup on every location; older backups keep their old passphrase.

## 2. Add a location

Click **Add location** and choose the type.

### SCP (SSH), recommended

1. On the backup server, create a user (for example `backup`) and a folder for the backups.
2. Leave **Sign in with** on **SSH key of this server**. Copy the public key shown in the form and add it to `~/.ssh/authorized_keys` of that user:
   ```bash
   sudo -u backup mkdir -p ~backup/.ssh
   echo 'ssh-ed25519 AAAA… captive-portal@server' | sudo -u backup tee -a ~backup/.ssh/authorized_keys
   ```
   You can also sign in with a password instead.
3. Fill in server, port (22), user name and folder, for example `/srv/backups/captive-portal`.
4. Click **Test connection**. The server's host key fingerprint is shown and remembered; if it ever changes, backups stop with a clear message until you click **Forget** in the location settings.

Files go over the SSH file transfer channel (SFTP subsystem), which every server with SCP offers (OpenSSH, Synology, QNAP, TrueNAS, Hetzner Storage Box and so on).

### FTPS

Fill in server, user name, password and folder. **Explicit** TLS (port 21, `AUTH TLS`) is what most servers use; choose **Implicit** for servers on port 990. Leave **Check the certificate** on, unless the server has a self-signed certificate you trust. At least TLS 1.2 is required.

### FTP

Only for a trusted network: the password travels unencrypted. The backups themselves are still encrypted.

### Local folder

A folder inside `/var/lib/captive-portal/backups/`. Useful as a quick extra copy or when that folder is a mounted network share, but not a replacement for an off-site backup.

### Schedule and retention

Default: a full backup every Sunday at 02:00 and an incremental backup every day at 02:00, keeping 4 full backups (about a month). Times are in the server's time zone. A backup that fails is retried after half an hour. Turn **Automatic backups** off to only back up by hand with **Full backup now** or **Incremental now**.

## What is in a backup

| Included | Not included |
| --- | --- |
| The complete PostgreSQL database | Pre-update and pre-restore safety copies (`backups/`) |
| The data folder `/var/lib/captive-portal` | Update state (`update/`) and work folders |
| `APP_SECRET` (needed to read stored passwords and API keys) | The application itself (installed from GitHub) |
| | Caddy's certificates (requested again automatically) |

On the location every backup is a folder such as `cp-20261020-020000-full` with `info.json` (type, date and version, nothing secret), `manifest.bin` (encrypted list of contents) and `objects/` (encrypted, compressed content). An incremental folder only holds the new content and refers to the older folders for the rest, so never delete single folders by hand: retention removes whole chains.

## Restore

1. Open **Backups & restore** on the location.
2. Choose the moment to go back to and click **Restore**.
3. Read the warnings, tick the box and click **Restore now**. Only for a backup made with another passphrase (for example from another server), fill in that passphrase.

What happens:

1. The passphrase is checked right away. A backup made with a **newer version** is refused: update this server first.
2. The app downloads the backup (and the older backups it builds on), decrypts it and checks every part against its SHA-256 checksum.
3. The system service (as root, like updates) stops Captive Portal and saves the current state to `/var/lib/captive-portal/backups/pre-restore-<date>…` (kept 30 days).
4. The database is replaced **in one transaction**: if anything goes wrong, the current database stays as it was.
5. The data folder and `APP_SECRET` are put back and the service starts. Database migrations bring a backup from an older version up to date.
6. If the service does not come up healthy, the previous state is put back automatically.

The page shows the progress and reconnects after the restart. Users, sessions and passwords come from the backup, so you may need to sign in again with an account from the backup. Log: `/var/log/captive-portal-restore.log`.

### Disaster recovery on a new server

1. Install Captive Portal on the new server ([installation](installation.md)) and create a temporary admin account.
2. Under **Backups**, set the same passphrase (or fill it in when restoring) and add the location with the backups.
3. Restore the newest backup. Everything comes back, including `APP_SECRET`, customers, hostnames and settings.
4. Point the DNS records of the admin panel and the customer hostnames to the new server; Caddy requests new certificates by itself.

## Troubleshooting

| Message | What to do |
| --- | --- |
| *Could not connect* | Check server, port, firewall and credentials with **Test connection**. |
| *The SSH host key … has changed* | Expected after reinstalling the backup server? Click **Forget** next to the host key and test again. Otherwise investigate before continuing. |
| *The passphrase does not match this backup* | The backup was made with another passphrase; fill it in under *Other passphrase*. |
| *This backup was made with version x* | Update this server to at least that version first. |
| *Restoring from the interface is not enabled* | Only on installations made with the installer (it sets up the update service). |
