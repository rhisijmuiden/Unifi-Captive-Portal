#!/usr/bin/env bash
# Captive Portal restore. Runs as root, started by update.sh when the web interface asks for a
# restore (update/request.json with action "restore"). The app has already downloaded, decrypted
# and checked the backup into restore/staging:
#   database.sql   complete pg_dump of the backup
#   files/         the data folder of the backup
#   app-secret     the APP_SECRET the stored secrets in that database are encrypted with
#
#   restore.sh <set-id>
#
# The service is stopped, the database is replaced in one transaction, the data folder and
# APP_SECRET are put back and the service is started again. If it does not come up healthy,
# the database, data folder and configuration from just before the restore are put back.
set -uo pipefail

DATA_DIR=/var/lib/captive-portal
ENV_FILE=/etc/captive-portal/captive-portal.env
APP_USER=captive-portal
RESTORE_DIR="$DATA_DIR/restore"
STAGING="$RESTORE_DIR/staging"
STATUS="$RESTORE_DIR/status.json"
LOG=/var/log/captive-portal-restore.log
# Data-folder entries that belong to this server, not to the backup
KEEP='^(update|backups|backup-work|restore)$'

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }

SET_ID="${1:-}"
[[ "$SET_ID" =~ ^cp-[0-9]{8}-[0-9]{6}-(full|incr)$ ]] || { echo "Usage: restore.sh <set-id>" >&2; exit 1; }

status() { # state code message — the web interface translates the code, the message is the English fallback
  install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$RESTORE_DIR"
  jq -n --arg state "$1" --arg code "$2" --arg message "$3" --arg setId "$SET_ID" --arg at "$(date -Iseconds)" \
    '{state:$state, code:$code, message:$message, setId:$setId, updatedAt:$at}' >"$STATUS.tmp"
  chown "$APP_USER:$APP_USER" "$STATUS.tmp"
  mv "$STATUS.tmp" "$STATUS"
}

exec > >(tee -a "$LOG") 2>&1
echo "=== $(date -Iseconds) restore of $SET_ID started ==="

if [[ ! -s "$STAGING/database.sql" || ! -d "$STAGING/files" ]] || [[ "$(jq -r '.setId // empty' "$STAGING/restore.json" 2>/dev/null)" != "$SET_ID" ]]; then
  status failed notPrepared "The backup was not prepared; start the restore again from the web interface"
  exit 1
fi

DATABASE_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
STAMP="$(date +%Y%m%d-%H%M%S)"
SAFETY_DB="$DATA_DIR/backups/pre-restore-$STAMP.sql.gz"
SAFETY_FILES="$DATA_DIR/backups/pre-restore-$STAMP-files"
SAFETY_ENV="$DATA_DIR/backups/pre-restore-$STAMP.env"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$DATA_DIR/backups"

# Replaces the schema with a dump in one transaction: on any error nothing changes
load_database() {
  {
    echo 'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
    cat
  } | PGOPTIONS="-c client_min_messages=warning" psql -q -X -1 -v ON_ERROR_STOP=1 "$DATABASE_URL" >/dev/null
}

healthy() {
  for _ in $(seq 1 60); do curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1 && return 0; sleep 1; done
  return 1
}

status running stopping "Stopping the service"
systemctl stop captive-portal

status running safety "Saving the current state"
if ! pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip >"$SAFETY_DB"; then
  systemctl start captive-portal
  status failed safetyFailed "Saving the current database failed; nothing was changed"
  exit 1
fi
cp -a "$ENV_FILE" "$SAFETY_ENV"
install -d -m 0750 "$SAFETY_FILES"
find "$DATA_DIR" -mindepth 1 -maxdepth 1 -printf '%f\n' | grep -Ev "$KEEP" | while read -r entry; do
  mv "$DATA_DIR/$entry" "$SAFETY_FILES/"
done
chown -R "$APP_USER:$APP_USER" "$SAFETY_DB" "$SAFETY_FILES" "$SAFETY_ENV"
chmod 0600 "$SAFETY_ENV"
echo "Current state saved: $SAFETY_DB, $SAFETY_FILES"

rollback() {
  echo "Restore failed, putting back the state from before the restore"
  systemctl stop captive-portal
  gunzip -c "$SAFETY_DB" | load_database
  find "$DATA_DIR" -mindepth 1 -maxdepth 1 -printf '%f\n' | grep -Ev "$KEEP" | while read -r entry; do rm -rf "${DATA_DIR:?}/$entry"; done
  cp -a "$SAFETY_FILES/." "$DATA_DIR/"
  install -m 0640 -o root -g "$APP_USER" "$SAFETY_ENV" "$ENV_FILE"
  systemctl start captive-portal
  healthy || true
}

status running database "Restoring the database"
if ! load_database <"$STAGING/database.sql"; then
  systemctl start captive-portal
  status failed databaseFailed "Restoring the database failed; the current database was kept"
  exit 1
fi

status running files "Restoring files and configuration"
cp -a "$STAGING/files/." "$DATA_DIR/"
chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
SECRET="$(cat "$STAGING/app-secret" 2>/dev/null || true)"
if [[ "$SECRET" =~ ^[A-Za-z0-9+/=_.-]{16,200}$ ]] && [[ "$(grep '^APP_SECRET=' "$ENV_FILE" | cut -d= -f2-)" != "$SECRET" ]]; then
  # Secrets in the restored database (SMTP, SSO, payment keys) are encrypted with the old APP_SECRET
  sed -i "s|^APP_SECRET=.*|APP_SECRET=${SECRET}|" "$ENV_FILE"
  echo "APP_SECRET taken over from the backup"
fi

status running starting "Starting the service"
# Migrations run on start, so a backup from an older version is brought up to date
systemctl start captive-portal
if ! healthy; then
  rollback
  status failed rolledBack "The service did not start after the restore; the previous state was put back. See $LOG"
  exit 1
fi

rm -rf "$STAGING"
# Keep the safety copies of the last 30 days
find "$DATA_DIR/backups" -maxdepth 1 -name 'pre-restore-*' -mtime +30 -exec rm -rf {} +
status success success "Backup $SET_ID restored"
echo "=== $(date -Iseconds) restore of $SET_ID finished ==="
