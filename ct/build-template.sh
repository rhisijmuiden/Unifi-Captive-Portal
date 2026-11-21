#!/usr/bin/env bash
# Builds the Proxmox VE container template (CT template) for Captive Portal.
#
# Starts from Proxmox's own Debian 13 "standard" template, installs the application into it
# (install.sh with CP_STAGE=build) and packs it again. On the first boot of a container made
# from it, captive-portal-firstboot.service creates this server's secrets, database and main
# administrator, and the console shows the web address with the login details.
#
#   sudo ct/build-template.sh --ref v1.2.3 [--out dist] [--repo https://github.com/…git | /path/to/repo.bundle]
#                             [--ca-cert proxy-ca.pem]   extra CA while building, e.g. behind an HTTPS proxy
#
# Runs on any Linux host with root, curl, tar and zstd (used by the release workflow on GitHub).
set -euo pipefail

REF=""
OUT="dist"
REPO="https://github.com/rhisijmuiden/Unifi-Captive-Portal.git"
ORIGIN="https://github.com/rhisijmuiden/Unifi-Captive-Portal.git"
ARCH=amd64
APLINFO_URL="http://download.proxmox.com/images/aplinfo-pve-9.dat"
IMAGES_URL="http://download.proxmox.com/images"
NAME="captive-portal-debian-13-${ARCH}.tar.zst"
CA_CERT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="$2"; shift ;;
    --out) OUT="$2"; shift ;;
    --repo) REPO="$2"; shift ;;
    --name) NAME="$2"; shift ;;
    --ca-cert) CA_CERT="$2"; shift ;;
    -h | --help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option $1" >&2; exit 1 ;;
  esac
  shift
done
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ -n "$REF" ]] || { echo "--ref is required (a tag such as v1.2.3, or a branch)" >&2; exit 1; }
for tool in curl tar zstd sha512sum chroot; do command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }; done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
WORK="$(mktemp -d /var/tmp/cp-template.XXXXXX)"
ROOT="$WORK/rootfs"
mkdir -p "$ROOT"

cleanup() {
  for m in dev/pts dev proc sys run/cp-src; do mountpoint -q "$ROOT/$m" 2>/dev/null && umount -l "$ROOT/$m"; done
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "==> Looking up the newest Proxmox Debian 13 standard template"
curl -fsSL "$APLINFO_URL" -o "$WORK/aplinfo.dat"
# aplinfo.dat: blank-line separated records with "Key: value" lines
read -r LOCATION SHA512 < <(awk -v arch="$ARCH" 'BEGIN{RS=""; FS="\n"}
  /Package: debian-13-standard/ && $0 ~ "Architecture: " arch {
    loc=""; sum="";
    for (i=1; i<=NF; i++) { if ($i ~ /^Location: /) loc=substr($i, 11); if ($i ~ /^sha512sum: /) sum=substr($i, 12) }
    print loc, sum
  }' "$WORK/aplinfo.dat" | sort -V | tail -n1)
[[ -n "${LOCATION:-}" && -n "${SHA512:-}" ]] || { echo "No debian-13-standard template found in $APLINFO_URL" >&2; exit 1; }
BASE="$(basename "$LOCATION")"
echo "    $BASE"
curl -fsSL "$IMAGES_URL/$LOCATION" -o "$WORK/$BASE"
echo "$SHA512  $WORK/$BASE" | sha512sum -c --quiet

echo "==> Unpacking"
tar --numeric-owner --xattrs --xattrs-include='*' -xpf "$WORK/$BASE" -C "$ROOT"
rm -f "$WORK/$BASE"

echo "==> Installing Captive Portal $REF into the template"
mount -t proc proc "$ROOT/proc"
mount -t sysfs sys "$ROOT/sys"
mount --bind /dev "$ROOT/dev"
mount --bind /dev/pts "$ROOT/dev/pts"
# Proxmox writes resolv.conf and hostname when it creates a container; keep the template's own versions
cp -a "$ROOT/etc/resolv.conf" "$WORK/resolv.conf" 2>/dev/null || true
rm -f "$ROOT/etc/resolv.conf"
cp /etc/resolv.conf "$ROOT/etc/resolv.conf"
# Nothing may start inside the chroot
printf '#!/bin/sh\nexit 101\n' >"$ROOT/usr/sbin/policy-rc.d"
chmod 0755 "$ROOT/usr/sbin/policy-rc.d"

SRC="$REPO"
if [[ -f "$REPO" || -d "$REPO" ]]; then
  # A local bundle or checkout: make it visible inside the chroot
  mkdir -p "$ROOT/run/cp-src"
  if [[ -f "$REPO" ]]; then
    cp "$REPO" "$ROOT/run/cp-src/repo.bundle"
    SRC=/run/cp-src/repo.bundle
  else
    mount --bind "$REPO" "$ROOT/run/cp-src"
    SRC=/run/cp-src
  fi
fi
install -m 0755 "$HERE/install/install.sh" "$ROOT/root/cp-install.sh"
BUILD_ENV=(PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root TERM=dumb)
for v in http_proxy https_proxy no_proxy HTTP_PROXY HTTPS_PROXY NO_PROXY npm_config_https_proxy; do [[ -n "${!v:-}" ]] && BUILD_ENV+=("$v=${!v}"); done
if [[ -n "$CA_CERT" ]]; then
  install -m 0644 "$CA_CERT" "$ROOT/usr/local/share/ca-certificates/cp-build-ca.crt"
  chroot "$ROOT" update-ca-certificates >/dev/null
  BUILD_ENV+=(NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/cp-build-ca.crt)
fi
chroot "$ROOT" /usr/bin/env -i "${BUILD_ENV[@]}" CP_STAGE=build CP_REPO_URL="$SRC" CP_REF="$REF" bash /root/cp-install.sh
# Updates from the web interface come from GitHub, whatever the template was built from
chroot "$ROOT" git -C /opt/captive-portal remote set-url origin "$ORIGIN"
VERSION="$(chroot "$ROOT" node -p "require('/opt/captive-portal/package.json').version")"

echo "==> Cleaning up"
if [[ -n "$CA_CERT" ]]; then
  rm -f "$ROOT/usr/local/share/ca-certificates/cp-build-ca.crt"
  chroot "$ROOT" update-ca-certificates --fresh >/dev/null
fi
mountpoint -q "$ROOT/run/cp-src" && umount "$ROOT/run/cp-src"
rm -rf "$ROOT/run/cp-src"
chroot "$ROOT" apt-get clean
rm -rf "$ROOT"/var/lib/apt/lists/* "$ROOT"/root/.npm "$ROOT"/root/.cache "$ROOT"/tmp/* "$ROOT"/var/tmp/* "$ROOT/root/cp-install.sh" "$ROOT/usr/sbin/policy-rc.d"
rm -f "$ROOT"/etc/ssh/ssh_host_*
: >"$ROOT/etc/machine-id"
rm -f "$ROOT/var/lib/dbus/machine-id"
# -c: no O_CREAT, which fs.protected_regular refuses in sticky folders such as /var/log/postgresql
find "$ROOT/var/log" -type f -exec truncate -c -s 0 {} + || true
rm -f "$ROOT/etc/resolv.conf"
if [[ -e "$WORK/resolv.conf" || -L "$WORK/resolv.conf" ]]; then cp -a "$WORK/resolv.conf" "$ROOT/etc/resolv.conf"; else : >"$ROOT/etc/resolv.conf"; fi
for m in dev/pts dev sys proc; do umount "$ROOT/$m"; done

echo "==> Packing $NAME"
tar --numeric-owner --xattrs --xattrs-include='*' -C "$ROOT" -cpf - . | zstd -q -T0 -19 -o "$OUT/$NAME" -f
(cd "$OUT" && sha256sum "$NAME" >"$NAME.sha256")
echo "$VERSION" >"$OUT/template-version.txt"
echo "==> Done: $OUT/$NAME ($(du -h "$OUT/$NAME" | cut -f1), Captive Portal $VERSION, base $BASE)"
