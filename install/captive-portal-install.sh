#!/usr/bin/env bash
# Runs inside the new Debian 13 LXC (called by ct/captive-portal.sh through the community-scripts engine).
# Author: RHIS (https://rhis.nl) | Source: https://github.com/rhisijmuiden/Unifi-Captive-Portal

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

msg_info "Installing Captive Portal"
INSTALLER_URL="${COMMUNITY_SCRIPTS_URL:-https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main}/install/install.sh"
$STD bash -c "$(curl -fsSL "$INSTALLER_URL")"
msg_ok "Installed Captive Portal"

motd_ssh
customize
cleanup_lxc
