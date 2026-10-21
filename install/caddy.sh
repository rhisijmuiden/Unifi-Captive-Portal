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
  # debian-keyring and apt-transport-https from Caddy's own guide are not needed (and not on every Debian 13)
  apt-get update -qq
  apt-get install -y -qq debian-archive-keyring curl gnupg >/dev/null
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

# The Caddy package ships a sample site on :80 (serving /usr/share/caddy); that one is ours to replace
is_package_default() {
  [[ "$(grep -v '^[[:space:]]*#' "$CADDYFILE" | tr -d '[:space:]')" == ':80{root*/usr/share/caddyfile_server}' ]]
}

if [[ ! -f "$CADDYFILE" ]] || head -n1 "$CADDYFILE" | grep -qF "$MARKER" || ! grep -q '[^[:space:]]' <(grep -v '^#' "$CADDYFILE") || is_package_default; then
  install -m 0644 "$APP_DIR/deploy/caddy/Caddyfile" "$CADDYFILE"
elif ! grep -q 'api/caddy/ask' "$CADDYFILE"; then
  echo " ! $CADDYFILE was changed by hand; leaving it alone. See $APP_DIR/deploy/caddy/Caddyfile"
fi
# An empty e-mail is not allowed by Caddy; drop the line in that case
if ! grep -q '^CP_ACME_EMAIL=.' "$CONF_DIR/caddy.env" && head -n1 "$CADDYFILE" | grep -qF "$MARKER"; then
  sed -i '/email {\$CP_ACME_EMAIL}/d' "$CADDYFILE"
fi

# Another web server on 80/443 keeps Caddy from starting
busy=$(ss -Hltnp '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v '"caddy"' | grep -oP 'users:\(\("\K[^"]+' | sort -u | tr '\n' ' ' || true)
if [[ -n "$busy" ]]; then
  echo " ✗ Port 80/443 is in use by: $busy" >&2
  echo "   Stop and disable it (e.g. systemctl disable --now apache2 nginx), then run: bash $APP_DIR/install/caddy.sh" >&2
  exit 1
fi

# Validate with the same environment the service gets, so {$CP_ACME_EMAIL} is filled in
( set -a; . "$CONF_DIR/caddy.env"; set +a; caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null )
systemctl daemon-reload
systemctl enable caddy >/dev/null
systemctl restart caddy

# Wait until Caddy really listens; show its log when it does not
for _ in $(seq 1 15); do
  if systemctl is-active --quiet caddy && (exec 3<>/dev/tcp/127.0.0.1/443) 2>/dev/null; then
    echo " ✓ Caddy $(caddy version | awk '{print $1}') serves HTTPS on ports 80/443"
    exit 0
  fi
  sleep 1
done
echo " ✗ Caddy did not start listening on port 443. Last log lines:" >&2
journalctl -u caddy -n 30 --no-pager >&2 || true
exit 1
