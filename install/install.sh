#!/usr/bin/env bash
# Captive Portal installer for Debian 13 (Trixie): VM, physical server or LXC.
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main/install/install.sh)"
#
# Safe to run again: existing configuration, database and data are kept.
# Options (environment variables):
#   CP_REF=v1.2.3        install a specific tag or branch (default: newest release tag, else main)
#   CP_PUBLIC_URL=...    public URL of the admin panel (default: http://<server-ip>:8080)
#   CP_NODE_MAJOR=24     Node.js major version from NodeSource
#   CP_ACME_EMAIL=...    e-mail for Let's Encrypt expiry notices (optional)
#   CP_CADDY=0           do not install Caddy (HTTPS on 80/443), e.g. behind your own proxy
set -euo pipefail

REPO_URL="${CP_REPO_URL:-https://github.com/rhisijmuiden/Unifi-Captive-Portal.git}"
APP_DIR=/opt/captive-portal
DATA_DIR=/var/lib/captive-portal
CONF_DIR=/etc/captive-portal
ENV_FILE="$CONF_DIR/captive-portal.env"
APP_USER=captive-portal
NODE_MAJOR="${CP_NODE_MAJOR:-24}"

c_ok=$'\e[32m'; c_info=$'\e[36m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_off=$'\e[0m'
info() { echo "${c_info}==>${c_off} $*"; }
ok() { echo "${c_ok} ✓${c_off} $*"; }
warn() { echo "${c_warn} !${c_off} $*"; }
die() { echo "${c_err} ✗ $*${c_off}" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run this installer as root (sudo -i)."
. /etc/os-release
if [[ "${ID:-}" != "debian" || "${VERSION_ID:-}" != "13" ]]; then
  warn "This installer targets Debian 13; detected ${PRETTY_NAME:-unknown}. Continuing anyway."
fi

export DEBIAN_FRONTEND=noninteractive

info "Installing system packages"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git jq openssl postgresql postgresql-contrib sudo >/dev/null
ok "System packages installed"

if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  info "Installing Node.js ${NODE_MAJOR} LTS (NodeSource)"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node.js $(node -v)"

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$DATA_DIR" "$DATA_DIR/update" "$DATA_DIR/backups" "$DATA_DIR/restore"
install -d -o root -g "$APP_USER" -m 0750 "$CONF_DIR"

info "Downloading the application"
if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone --quiet "$REPO_URL" "$APP_DIR"
fi
git -C "$APP_DIR" fetch --quiet --tags --force origin
REF="${CP_REF:-}"
if [[ -z "$REF" ]]; then
  REF="$(git -C "$APP_DIR" tag --list 'v*' --sort=-v:refname | head -n1)"
  REF="${REF:-origin/main}"
fi
git -C "$APP_DIR" checkout --quiet --force "$REF"
ok "Source at $REF"

info "Preparing the database"
systemctl enable --now postgresql >/dev/null
if [[ ! -f "$ENV_FILE" ]]; then
  DB_PASS="$(openssl rand -hex 24)"
  APP_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  IP="$(hostname -I | awk '{print $1}')"
  PUBLIC_URL="${CP_PUBLIC_URL:-http://${IP:-localhost}:8080}"
  sudo -u postgres psql -qtAc "SELECT 1 FROM pg_roles WHERE rolname='captive'" | grep -q 1 \
    && sudo -u postgres psql -qc "ALTER ROLE captive WITH LOGIN PASSWORD '${DB_PASS}'" \
    || sudo -u postgres psql -qc "CREATE ROLE captive WITH LOGIN PASSWORD '${DB_PASS}'"
  cat >"$ENV_FILE" <<EOF
# Captive Portal configuration. Restart after changes: systemctl restart captive-portal
DATABASE_URL=postgres://captive:${DB_PASS}@127.0.0.1:5432/captive
APP_SECRET=${APP_SECRET}
PORT=8080
HOST=0.0.0.0
PUBLIC_URL=${PUBLIC_URL}
DATA_DIR=${DATA_DIR}
UPDATE_REPO=rhisijmuiden/Unifi-Captive-Portal
NODE_ENV=production
EOF
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
fi
sudo -u postgres psql -qtAc "SELECT 1 FROM pg_database WHERE datname='captive'" | grep -q 1 \
  || sudo -u postgres createdb -O captive captive
ok "PostgreSQL database ready"

info "Building the application (this takes a minute)"
cd "$APP_DIR"
npm ci --include=dev --no-audit --no-fund --loglevel=error
npm run build --silent
npm prune --omit=dev --no-audit --no-fund --loglevel=error
ok "Build complete"

info "Applying database migrations"
sudo -u "$APP_USER" bash -c "set -a; . '$ENV_FILE'; set +a; cd '$APP_DIR/server' && node dist/db/migrate.js"

info "Installing services"
install -m 0644 deploy/systemd/captive-portal.service /etc/systemd/system/
install -m 0644 deploy/systemd/captive-portal-updater.service /etc/systemd/system/
install -m 0644 deploy/systemd/captive-portal-updater.path /etc/systemd/system/
chmod 0755 install/update.sh install/restore.sh
ln -sf "$APP_DIR/install/update.sh" /usr/local/bin/captive-portal-update
touch "$DATA_DIR/update/enabled"
chown "$APP_USER:$APP_USER" "$DATA_DIR/update/enabled"
systemctl daemon-reload
systemctl enable --now captive-portal-updater.path >/dev/null
systemctl enable captive-portal >/dev/null
systemctl restart captive-portal

for _ in $(seq 1 30); do
  curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1 || die "The service did not start. Check: journalctl -u captive-portal -n 50"

info "Setting up HTTPS (Caddy)"
APP_DIR="$APP_DIR" bash "$APP_DIR/install/caddy.sh" || warn "Caddy could not be set up; the app still runs on port 8080. Retry: bash $APP_DIR/install/caddy.sh"

URL="$(grep '^PUBLIC_URL=' "$ENV_FILE" | cut -d= -f2-)"
echo
ok "Captive Portal $(node -p "require('$APP_DIR/package.json').version") is running"
echo "   Open ${c_info}${URL}${c_off} to create the first administrator account."
echo "   Then set the public IP and an HTTPS hostname for this panel under System → Hosting & SSL."
echo "   Configuration: $ENV_FILE"
echo "   Update later:  captive-portal-update   (or via Info & updates in the web interface)"
