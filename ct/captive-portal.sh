#!/usr/bin/env bash
# Captive Portal LXC for Proxmox VE, built on the community-scripts Debian 13 container
# (same engine as https://github.com/community-scripts/ProxmoxVE/blob/main/ct/debian.sh).
#
# Run on the Proxmox host:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main/ct/captive-portal.sh)"
#
# The engine fetches install/captive-portal-install.sh from this repository instead of the
# community repository, because COMMUNITY_SCRIPTS_URL points here.
export COMMUNITY_SCRIPTS_URL="${COMMUNITY_SCRIPTS_URL:-https://raw.githubusercontent.com/rhisijmuiden/Unifi-Captive-Portal/main}"
_cs_boot="${COMMUNITY_SCRIPTS_CORE_DIR:-$(dirname "${BASH_SOURCE[0]}")/../../core}/core/build.func"
source "$_cs_boot" 2>/dev/null || source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/main}/core/build.func")
# Author: RHIS (https://rhis.nl)
# License: MIT (community-scripts engine) | Source: https://github.com/rhisijmuiden/Unifi-Captive-Portal

APP="Captive-Portal"
var_tags="${var_tags:-network;unifi;wifi}"
var_cpu="${var_cpu:-2}"
var_ram="${var_ram:-2048}"
var_disk="${var_disk:-8}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_arm64="${var_arm64:-no}"
var_unprivileged="${var_unprivileged:-1}"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources
  if [[ ! -d /opt/captive-portal ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi
  msg_info "Updating ${APP} (application and Debian packages)"
  /opt/captive-portal/install/update.sh --system
  msg_ok "Updated successfully!"
  exit
}

start
build_container
description

msg_ok "Completed successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW} Open the admin panel to create the first administrator:${CL}"
echo -e "${TAB}${GATEWAY}${BGN}http://${IP}:8080${CL}"
