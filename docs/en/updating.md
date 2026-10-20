# Updating and release channels

> 🇳🇱 [Nederlandse versie](../nl/updaten.md)

## Release channels

| Channel | What you get | For |
| --- | --- | --- |
| **Stable** | Tested releases only, such as `1.2.0` | Production, customer environments |
| **Test** | Test versions too, such as `1.3.0-beta.1`, so you see new features earlier | A test server or demo environment |

The test channel also sees every stable release, so you never fall behind. Choose the channel in **Info & updates** (bottom of the left menu). Only platform admins see these options.

## Updating from the web interface

1. Click **Info & updates** at the bottom left.
2. Choose the channel and click **Check for updates**.
3. Leave **Update the whole installation** on to also update Debian, PostgreSQL and Node.js (apt). Turn it off to update only the application.
4. Click **Update to x.y.z**. When there is no new version, **Update system packages** updates Debian only.

During the update you see the progress and the last lines of the log. The application restarts at the end; the page keeps working afterwards.

### What happens

1. A **database backup** is written to `/var/lib/captive-portal/backups/pre-update-<version>-<date>.sql.gz` (kept for 30 days).
2. Optional: `apt full-upgrade` of the system.
3. The new version is fetched and built, and database migrations run.
4. The service restarts and is checked for a response.
5. **If that fails**, the previous version and the database backup are restored automatically.

The web application itself never runs as root. It only writes an update request to `/var/lib/captive-portal/update/request.json`; the systemd unit `captive-portal-updater.path` notices it and starts the updater as root. The updater reads only a version number and a yes/no for system packages from that file.

> The pre-update database backup stays on this server. For off-site, encrypted backups and restoring them, see [Backups and restore](backups.md).

## Updating from the terminal

```bash
captive-portal-update                    # latest stable version
captive-portal-update --channel test     # latest version including test versions
captive-portal-update 0.2.0              # a specific version
captive-portal-update --system           # also update Debian packages
```

The log is in `/var/log/captive-portal-update.log`.

## Rolling back by hand

```bash
cd /opt/captive-portal
git checkout v0.1.0                       # the version you want
captive-portal-update 0.1.0
# restore the database from a backup:
sudo -u postgres psql -d captive -c 'DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public AUTHORIZATION captive;'
set -a; . /etc/captive-portal/captive-portal.env; set +a
gunzip -c /var/lib/captive-portal/backups/pre-update-….sql.gz | psql "$DATABASE_URL"
systemctl restart captive-portal
```
