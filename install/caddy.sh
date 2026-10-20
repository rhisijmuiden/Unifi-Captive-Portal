#!/usr/bin/env bash
# Installs Caddy as HTTPS front end for the Captive Portal (ports 80 and 443).
# Called by install.sh and update.sh; safe to run again.
#   CP_ACME_EMAIL=you@company.com   address Let's Encrypt uses for expiry notices (optional)
#   CP_CADDY=0                      skip Caddy (e.g. when you run your own reverse proxy)
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/captive-portal}"
CONF_DIR=/etc/captive-portal
CADDYFILE=/etc/caddy/Caddyfile
MARKER='# Managed by Captive Portal'

[[ "${CP_CADDY:-1}" == "0" ]] && { echo "Caddy skipped (CP_CADDY=0)"; exit 0; }
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }

if ! command -v caddy >/dev/null; then
  echo "==> Installing Caddy (official repository)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg >/dev/null
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

# The ACME e-mail lives in an environment file so updates never lose it
install -d -m 0755 /etc/systemd/system/caddy.service.d
if [[ ! -f "$CONF_DIR/caddy.env" || -n "${CP_ACME_EMAIL:-}" ]]; then
  install -d -m 0755 "$CONF_DIR"
  echo "CP_ACME_EMAIL=${CP_ACME_EMAIL:-}" >"$CONF_DIR/caddy.env"
  chmod 0644 "$CONF_DIR/caddy.env"
fi
cat >/etc/systemd/system/caddy.service.d/captive-portal.conf <<CONF
[Service]
EnvironmentFile=$CONF_DIR/caddy.env
CONF

if [[ ! -f "$CADDYFILE" ]] || head -n1 "$CADDYFILE" | grep -qF "$MARKER" || ! grep -q '[^[:space:]]' <(grep -v '^#' "$CADDYFILE"); then
  install -m 0644 "$APP_DIR/deploy/caddy/Caddyfile" "$CADDYFILE"
elif ! grep -q 'api/caddy/ask' "$CADDYFILE"; then
  echo " ! $CADDYFILE was changed by hand; leaving it alone. See $APP_DIR/deploy/caddy/Caddyfile"
fi
# An empty e-mail is not allowed by Caddy; drop the line in that case
if ! grep -q '^CP_ACME_EMAIL=.' "$CONF_DIR/caddy.env" && head -n1 "$CADDYFILE" | grep -qF "$MARKER"; then
  sed -i '/email {\$CP_ACME_EMAIL}/d' "$CADDYFILE"
fi

caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null
systemctl daemon-reload
systemctl enable caddy >/dev/null
systemctl restart caddy
echo " ✓ Caddy $(caddy version | awk '{print $1}') serves HTTPS on ports 80/443"
