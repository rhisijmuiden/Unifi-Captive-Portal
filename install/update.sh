#!/usr/bin/env bash
# Captive Portal updater. Runs as root, either by hand or from the web interface
# (captive-portal-updater.path starts it when the app writes update/request.json).
#
#   captive-portal-update                 update to the newest version in the configured channel
#   captive-portal-update 1.2.0           update to a specific version
#   captive-portal-update --system        also upgrade Debian packages (apt)
#   captive-portal-update --channel test  pick the newest version including pre-releases
#
# Restores requested from the web interface arrive the same way and are passed to restore.sh.
set -uo pipefail

# git checkout replaces this file while it runs, so continue from a private copy
if [[ -z "${CP_UPDATE_REEXEC:-}" ]]; then
  _copy="$(mktemp /tmp/captive-portal-update.XXXXXX)"
  cp "$(readlink -f "$0")" "$_copy"
  CP_UPDATE_REEXEC=1 exec bash "$_copy" "$@"
fi
trap 'rm -f "$0"' EXIT

APP_DIR=/opt/captive-portal
DATA_DIR=/var/lib/captive-portal
ENV_FILE=/etc/captive-portal/captive-portal.env
APP_USER=captive-portal
STATUS="$DATA_DIR/update/status.json"
REQUEST="$DATA_DIR/update/request.json"
LOG=/var/log/captive-portal-update.log

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo captive-portal-update" >&2; exit 1; }

VERSION=""
SYSTEM=false
CHANNEL=stable
FROM_REQUEST=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-request) FROM_REQUEST=true ;;
    --system) SYSTEM=true ;;
    --channel) CHANNEL="${2:-stable}"; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) VERSION="${1#v}" ;;
  esac
  shift
done

status() { # state code message — the web interface translates the code, the message is the English fallback
  local log_tail=""
  [[ -f "$LOG" ]] && log_tail="$(tail -n 25 "$LOG")"
  jq -n --arg state "$1" --arg code "$2" --arg message "$3" --arg version "$VERSION" --arg log "$log_tail" --arg at "$(date -Iseconds)" \
    '{state:$state, code:$code, message:$message, version:$version, log:$log, updatedAt:$at}' >"$STATUS.tmp"
  chown "$APP_USER:$APP_USER" "$STATUS.tmp"
  mv "$STATUS.tmp" "$STATUS"
}

if $FROM_REQUEST; then
  [[ -f "$REQUEST" ]] || exit 0
  # The web interface also hands restores to this unit; restore.sh does the work
  if [[ "$(jq -r '.action // "update"' "$REQUEST")" == "restore" ]]; then
    SET_ID="$(jq -r '.setId // empty' "$REQUEST")"
    rm -f "$REQUEST" "$0"
    exec bash "$APP_DIR/install/restore.sh" "$SET_ID"
  fi
  # Only a version string and a boolean are taken from the app-writable request file
  VERSION="$(jq -r '.version // empty' "$REQUEST")"
  [[ "$(jq -r '.system // false' "$REQUEST")" == "true" ]] && SYSTEM=true
  rm -f "$REQUEST"
  [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { VERSION=""; status failed invalid "Invalid version in update request"; exit 1; }
fi

exec > >(tee -a "$LOG") 2>&1
echo "=== $(date -Iseconds) update started (version=${VERSION:-latest}, system=$SYSTEM) ==="

cd "$APP_DIR" || { status failed missingDir "Installation directory $APP_DIR not found"; exit 1; }
CURRENT="$(node -p "require('./package.json').version")"
PREVIOUS_REF="$(git rev-parse HEAD)"

git fetch --quiet --tags --force origin || { status failed unreachable "Could not reach GitHub"; exit 1; }
if [[ -z "$VERSION" ]]; then
  if [[ "$CHANNEL" == "test" ]]; then
    VERSION="$(git tag --list 'v*' --sort=-v:refname | head -n1)"
  else
    VERSION="$(git tag --list 'v*' --sort=-v:refname | grep -v -- '-' | head -n1)"
  fi
  VERSION="${VERSION#v}"
  [[ -n "$VERSION" ]] || VERSION="$CURRENT"
fi

status running backup "Backing up the database"
BACKUP="$DATA_DIR/backups/pre-update-${CURRENT}-$(date +%Y%m%d-%H%M%S).sql.gz"
# Only the database URL: exporting the whole file would set NODE_ENV=production,
# which makes npm ci skip the build tools (vite, typescript)
DATABASE_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
if ! pg_dump "$DATABASE_URL" | gzip >"$BACKUP"; then
  status failed backupFailed "Database backup failed, update aborted"
  exit 1
fi
chown "$APP_USER:$APP_USER" "$BACKUP"
echo "Database backup: $BACKUP"

if $SYSTEM; then
  status running system "Updating system packages (apt)"
  export DEBIAN_FRONTEND=noninteractive
  if ! { apt-get update -q && apt-get -y -q -o Dpkg::Options::=--force-confold full-upgrade && apt-get -y -q autoremove; }; then
    status failed systemFailed "Updating system packages failed"
    exit 1
  fi
fi

build_and_restart() {
  npm ci --include=dev --no-audit --no-fund --loglevel=error &&
    npm run build --silent &&
    npm prune --omit=dev --no-audit --no-fund --loglevel=error &&
    sudo -u "$APP_USER" bash -c "set -a; . '$ENV_FILE'; set +a; cd '$APP_DIR/server' && node dist/db/migrate.js" &&
    install -m 0644 deploy/systemd/*.service deploy/systemd/*.path /etc/systemd/system/ &&
    systemctl daemon-reload &&
    systemctl restart captive-portal &&
    for _ in $(seq 1 30); do curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1 && return 0; sleep 1; done
  return 1
}

if [[ "$VERSION" != "$CURRENT" ]]; then
  status running installing "Installing version $VERSION"
  if ! git checkout --quiet --force "v$VERSION"; then
    status failed notFound "Version $VERSION does not exist"
    exit 1
  fi
  if ! build_and_restart; then
    echo "Update failed, rolling back to $PREVIOUS_REF"
    status running rollback "Update failed, rolling back to $CURRENT"
    git checkout --quiet --force "$PREVIOUS_REF"
    # Migrations are forward-only; restore the pre-update database too
    sudo -u postgres psql -q -d captive -c 'DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public AUTHORIZATION captive;' &&
      gunzip -c "$BACKUP" | psql -q "$DATABASE_URL" >/dev/null
    build_and_restart
    VERSION="$CURRENT"
    status failed rolledBack "Update failed. Version $CURRENT was restored; see $LOG"
    exit 1
  fi
else
  echo "Application already at $CURRENT"
  $SYSTEM && systemctl restart captive-portal
fi

# Keep the HTTPS front end in step with the new version (also adds it to older installations)
if [[ -f "$APP_DIR/install/caddy.sh" ]]; then
  APP_DIR="$APP_DIR" bash "$APP_DIR/install/caddy.sh" || echo "Caddy setup failed; the app itself was updated"
fi

# Remove pre-update backups older than 30 days
find "$DATA_DIR/backups" -name 'pre-update-*.sql.gz' -mtime +30 -delete

status success success "Updated to version $VERSION"
echo "=== $(date -Iseconds) update finished: $VERSION ==="
