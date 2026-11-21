#!/usr/bin/env bash
# Captive Portal administration on the server itself (run as root):
#
#   captive-portal-admin                         web address, plus the main administrator's login while it still has the generated password
#   captive-portal-admin reset-password [login]  new generated password for a main administrator (e.g. when locked out)
#
# All other configuration is done in the web interface.
set -euo pipefail

APP_DIR=/opt/captive-portal
DATA_DIR=/var/lib/captive-portal
ENV_FILE=/etc/captive-portal/captive-portal.env
APP_USER=captive-portal

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo captive-portal-admin $*" >&2; exit 1; }

app_node() {
  runuser -u "$APP_USER" -- bash -c "set -a; . '$ENV_FILE'; set +a; cd '$APP_DIR/server' && node dist/cli/admin.js $(printf '%q ' "$@")"
}

# The banner is an agetty issue file: \4 is the current IPv4 address
show_banner() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [[ -f "$DATA_DIR/console.issue" ]] || { echo "Captive Portal is not set up yet." >&2; exit 1; }
  sed -e "s/\\\\4\({[^}]*}\)\{0,1\}/${ip:-<server-ip>}/g" "$DATA_DIR/console.issue"
}

case "${1:-info}" in
  info | show) show_banner ;;
  reset-password)
    app_node reset "${2:-}" >/dev/null
    echo "A new password was generated; the user chooses their own at the next sign-in."
    show_banner
    ;;
  refresh) app_node issue >/dev/null ;;
  -h | --help | help) sed -n '2,8p' "$0" ;;
  *) echo "Unknown command: $1 (see captive-portal-admin --help)" >&2; exit 1 ;;
esac
