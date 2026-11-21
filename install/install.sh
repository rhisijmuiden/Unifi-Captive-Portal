#!/usr/bin/env bash
# Captive Portal installer for a bare Debian 13 (Trixie): physical server, VM or (LXC) container.
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main/install/install.sh)"
#   bash -c "$(wget -qO- https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main/install/install.sh)"
#
# At the end only the web address and the main administrator's login details are shown;
# everything else is configured in the web interface. The full log is in /var/log/captive-portal-install.log.
# Safe to run again: existing configuration, database and data are kept.
#
# Options (environment variables):
#   CP_REF=v1.2.3        install a specific tag or branch (default: newest stable release, else main)
#   CP_CHANNEL=test      without CP_REF: newest release including test versions (default: stable)
#   CP_PUBLIC_URL=...    public URL of the admin panel (default: http://<server-ip>:8080)
#   CP_NODE_MAJOR=24     Node.js major version from NodeSource
#   CP_ACME_EMAIL=...    e-mail for Let's Encrypt expiry notices (optional)
#   CP_CADDY=0           do not install Caddy (HTTPS on 80/443), e.g. behind your own proxy
#   CP_STAGE=all         all | build (software only, used for the Proxmox template) |
#                        configure (secrets, database, admin; runs on the template's first boot) |
#                        system-files (services and helper commands; used by update.sh)
set -euo pipefail

REPO_URL="${CP_REPO_URL:-https://github.com/rhisijmuiden/Unifi-Captive-Portal.git}"
APP_DIR=/opt/captive-portal
DATA_DIR=/var/lib/captive-portal
CONF_DIR=/etc/captive-portal
ENV_FILE="$CONF_DIR/captive-portal.env"
APP_USER=captive-portal
NODE_MAJOR="${CP_NODE_MAJOR:-24}"
STAGE="${CP_STAGE:-all}"
LOG=/var/log/captive-portal-install.log
FIRSTBOOT_MARKER="$DATA_DIR/firstboot"

c_ok=$'\e[32m'; c_info=$'\e[36m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_dim=$'\e[2m'; c_off=$'\e[0m'
[[ -t 1 ]] || { c_ok=; c_info=; c_warn=; c_err=; c_dim=; c_off=; }
warn() { echo "  ${c_warn}!${c_off} $*"; }
die() { echo "  ${c_err}✗ $*${c_off}" >&2; exit 1; }

# Runs one step with its output in the log; on failure the last log lines are shown
step() {
  local title="$1" rc
  shift
  printf '  %s%s%s ' "$c_dim" "$title" "$c_off"
  echo "=== $(date -Iseconds) $title" >>"$LOG"
  set +e
  ( set -e; "$@" ) >>"$LOG" 2>&1
  rc=$?
  set -e
  if [[ $rc -eq 0 ]]; then
    echo "${c_ok}✓${c_off}"
  elif [[ -n "${SOFT:-}" ]]; then
    echo "${c_warn}!${c_off}"
    warn "$SOFT"
  else
    echo "${c_err}✗${c_off}"
    echo >&2
    tail -n 30 "$LOG" >&2
    die "$title failed. Full log: $LOG"
  fi
}

[[ $EUID -eq 0 ]] || die "Run this installer as root (su - or sudo -i)."
case "$STAGE" in all | build | configure | system-files) ;; *) die "Unknown CP_STAGE=$STAGE" ;; esac
touch "$LOG" && chmod 0600 "$LOG"
. /etc/os-release
export DEBIAN_FRONTEND=noninteractive
[[ -d /run/systemd/system || "$STAGE" == "build" ]] || die "systemd is not running. Use a server, VM or LXC container with systemd (Docker is not supported)."

# ---------------------------------------------------------------- build: the software

install_packages() {
  apt-get update -q
  apt-get install -y -q ca-certificates curl gnupg git jq openssl postgresql postgresql-contrib sudo iproute2 zstd
}

install_node() {
  if command -v node >/dev/null && [[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]]; then return 0; fi
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get install -y -q nodejs
}

create_user() {
  id "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
  install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$DATA_DIR" "$DATA_DIR/update" "$DATA_DIR/backups" "$DATA_DIR/restore"
  # The console banner lives here, so the data folder itself must be readable for getty and login
  chmod 0751 "$DATA_DIR"
  install -d -o root -g "$APP_USER" -m 0750 "$CONF_DIR"
}

fetch_source() {
  [[ -d "$APP_DIR/.git" ]] || git clone --quiet "$REPO_URL" "$APP_DIR"
  git -C "$APP_DIR" fetch --quiet --tags --force origin
  local ref="${CP_REF:-}"
  if [[ -z "$ref" ]]; then
    if [[ "${CP_CHANNEL:-stable}" == "test" ]]; then
      ref="$(git -C "$APP_DIR" tag --list 'v*' --sort=-v:refname | head -n1)"
    else
      ref="$(git -C "$APP_DIR" tag --list 'v*' --sort=-v:refname | grep -v -- '-' | head -n1 || true)"
    fi
    ref="${ref:-origin/main}"
  fi
  git -C "$APP_DIR" checkout --quiet --force "$ref"
  echo "Source at $ref"
}

build_app() {
  cd "$APP_DIR"
  # NODE_ENV must not be production here, or npm skips the build tools
  NODE_ENV=development npm ci --include=dev --no-audit --no-fund --loglevel=error
  npm run build --silent
  npm prune --omit=dev --no-audit --no-fund --loglevel=error
  rm -rf /root/.npm/_cacache
}

install_caddy_package() {
  CP_CADDY_INSTALL_ONLY=1 APP_DIR="$APP_DIR" bash "$APP_DIR/install/caddy.sh"
}

# Services, helper commands and the console banner. Also run by update.sh, so older installs get new files.
install_system_files() {
  cd "$APP_DIR"
  install -m 0644 deploy/systemd/*.service deploy/systemd/*.path /etc/systemd/system/
  chmod 0755 install/*.sh
  ln -sf "$APP_DIR/install/update.sh" /usr/local/bin/captive-portal-update
  ln -sf "$APP_DIR/install/admin.sh" /usr/local/bin/captive-portal-admin
  touch "$DATA_DIR/update/enabled"
  chown "$APP_USER:$APP_USER" "$DATA_DIR/update/enabled"
  # Console banner (agetty reads /etc/issue.d) and login message, both from the app's data folder
  install -d -m 0755 /etc/issue.d /etc/update-motd.d
  ln -sf "$DATA_DIR/console.issue" /etc/issue.d/captive-portal.issue
  install -m 0755 deploy/console/motd /etc/update-motd.d/90-captive-portal
  if [[ ! -f "$DATA_DIR/console.issue" ]]; then
    printf '\n  Captive Portal is finishing its first-time setup.\n  This takes about a minute; press Enter to refresh this screen.\n\n' >"$DATA_DIR/console.issue"
    chown "$APP_USER:$APP_USER" "$DATA_DIR/console.issue"
    chmod 0644 "$DATA_DIR/console.issue"
  fi
  if [[ -d /run/systemd/system ]]; then systemctl daemon-reload; fi
  systemctl enable captive-portal-updater.path captive-portal-console.path
  if [[ -d /run/systemd/system ]]; then systemctl start captive-portal-updater.path captive-portal-console.path; fi
}

# ---------------------------------------------------------------- configure: this server's secrets and data

prepare_database() {
  systemctl enable --now postgresql
  if [[ ! -f "$ENV_FILE" ]]; then
    local db_pass app_secret ip public_url
    db_pass="$(openssl rand -hex 24)"
    app_secret="$(openssl rand -base64 48 | tr -d '\n')"
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    public_url="${CP_PUBLIC_URL:-http://${ip:-localhost}:8080}"
    if runuser -u postgres -- psql -qtAc "SELECT 1 FROM pg_roles WHERE rolname='captive'" | grep -q 1; then
      runuser -u postgres -- psql -qc "ALTER ROLE captive WITH LOGIN PASSWORD '${db_pass}'"
    else
      runuser -u postgres -- psql -qc "CREATE ROLE captive WITH LOGIN PASSWORD '${db_pass}'"
    fi
    cat >"$ENV_FILE.tmp" <<EOF
# Captive Portal configuration. Restart after changes: systemctl restart captive-portal
DATABASE_URL=postgres://captive:${db_pass}@127.0.0.1:5432/captive
APP_SECRET=${app_secret}
PORT=8080
HOST=0.0.0.0
PUBLIC_URL=${public_url}
DATA_DIR=${DATA_DIR}
UPDATE_REPO=rhisijmuiden/Unifi-Captive-Portal
NODE_ENV=production
EOF
    chown root:"$APP_USER" "$ENV_FILE.tmp"
    chmod 0640 "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  fi
  runuser -u postgres -- psql -qtAc "SELECT 1 FROM pg_database WHERE datname='captive'" | grep -q 1 \
    || runuser -u postgres -- createdb -O captive captive
}

app_node() { # runs node as the app user with the configuration loaded
  runuser -u "$APP_USER" -- bash -c "set -a; . '$ENV_FILE'; set +a; cd '$APP_DIR/server' && node $*"
}

run_migrations() { app_node dist/db/migrate.js; }

healthy() {
  for _ in $(seq 1 30); do
    curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1 && return 0
    systemctl is-failed --quiet captive-portal && return 1
    sleep 1
  done
  return 1
}

start_service() {
  systemctl enable captive-portal
  systemctl restart captive-portal
  healthy && return 0
  # Containers without nesting cannot use systemd's sandboxing (exit status 226/NAMESPACE): run without it
  if [[ "$(systemctl show -p ExecMainStatus --value captive-portal)" == "226" ]] || systemd-detect-virt --container --quiet; then
    echo "Service did not start; retrying without systemd sandboxing (container without nesting)"
    install -d -m 0755 /etc/systemd/system/captive-portal.service.d
    cat >/etc/systemd/system/captive-portal.service.d/50-container.conf <<'EOF'
# Written by the installer: this container does not allow systemd's sandboxing.
# Enable "nesting" for the container and delete this file for the extra protection.
[Service]
PrivateTmp=false
ProtectSystem=false
ProtectHome=false
ProtectKernelTunables=false
ProtectControlGroups=false
RestrictSUIDSGID=false
EOF
    systemctl daemon-reload
    systemctl restart captive-portal
    healthy && return 0
  fi
  journalctl -u captive-portal -n 40 --no-pager
  return 1
}

setup_caddy() { APP_DIR="$APP_DIR" bash "$APP_DIR/install/caddy.sh"; }

create_admin() {
  local out
  out="$(app_node dist/cli/admin.js create)"
  echo "$out" | jq 'del(.password)'
}

finish_firstboot() {
  # A template copy needs its own SSH host keys and machine id (Proxmox makes both; elsewhere we do)
  if [[ -d /etc/ssh ]] && ! ls /etc/ssh/ssh_host_*_key >/dev/null 2>&1; then ssh-keygen -A; fi
  if [[ ! -s /etc/machine-id ]]; then systemd-machine-id-setup; fi
  rm -f "$FIRSTBOOT_MARKER"
  systemctl disable captive-portal-firstboot.service 2>/dev/null || true
}

summary() {
  # Only the web address and the login details stay on screen; the steps are in the log
  if [[ -t 1 && "${CP_KEEP_SCREEN:-0}" != "1" ]]; then clear; else echo; fi
  /usr/local/bin/captive-portal-admin info
}

# ---------------------------------------------------------------- stages

if [[ "$STAGE" == "system-files" ]]; then
  install_system_files
  exit 0
fi

if [[ "$STAGE" != "configure" ]]; then
  echo
  echo "  ${c_info}Captive Portal installer${c_off} ${c_dim}(${PRETTY_NAME:-unknown system})${c_off}"
  echo
  if [[ "${ID:-}" != "debian" || "${VERSION_ID:-}" != "13" ]]; then
    warn "This installer targets Debian 13; detected ${PRETTY_NAME:-unknown}. Continuing anyway."
  fi
  step "Installing system packages" install_packages
  step "Installing Node.js" install_node
  step "Creating service account" create_user
  step "Downloading the application" fetch_source
  step "Building the application (a few minutes)" build_app
  if [[ "${CP_CADDY:-1}" != "0" ]]; then step "Installing Caddy (HTTPS)" install_caddy_package; fi
  step "Installing services" install_system_files
fi

if [[ "$STAGE" == "build" ]]; then
  # The Proxmox template finishes the installation on its first boot
  touch "$FIRSTBOOT_MARKER"
  systemctl enable captive-portal-firstboot.service
  exit 0
fi

if [[ "$STAGE" == "configure" ]]; then echo; echo "  ${c_info}Captive Portal first-time setup${c_off}"; echo; fi
step "Preparing the database" prepare_database
step "Applying database migrations" run_migrations
step "Starting Captive Portal" start_service
if [[ "${CP_CADDY:-1}" != "0" ]]; then
  SOFT="Caddy could not be set up; the web interface still runs on port 8080. Details: $LOG, retry: bash $APP_DIR/install/caddy.sh" \
    step "Setting up HTTPS (Caddy)" setup_caddy
fi
step "Creating the main administrator" create_admin
[[ -f "$FIRSTBOOT_MARKER" ]] && step "Finishing first boot" finish_firstboot
summary
