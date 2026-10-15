#!/usr/bin/env bash
# Keep the latest release online on IPFS from this server. Run after
# publish-site.sh, as root:
#
#   /opt/covenant/covenant-frontend/scripts/pin-ipfs.sh
#
# First run installs Kubo (the IPFS node, checksum-verified) as a systemd
# service (ipfs). Every run imports and pins the newest release/*.car.
# Pinning on more machines (or a pinning service) keeps the CID up even if
# this server goes away.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)."; exit 1; }
cd "$(dirname "$0")/.."
CAR=$(ls -t release/covenant-*.car 2>/dev/null | head -1 || true)
[ -n "$CAR" ] || { echo "No release/covenant-*.car here. Run scripts/publish-site.sh first."; exit 1; }
export IPFS_PATH=/var/lib/ipfs

if ! command -v ipfs >/dev/null; then
  case "$(uname -m)" in x86_64) A=amd64 ;; aarch64|arm64) A=arm64 ;; *) echo "Unsupported CPU: $(uname -m)"; exit 1 ;; esac
  V=$(curl -fsSL https://dist.ipfs.tech/kubo/versions | grep -vE -- '-(rc|beta|alpha)' | tail -1)
  [[ "$V" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Couldn't find the latest Kubo version"; exit 1; }
  echo "Installing Kubo $V"
  F="kubo_${V}_linux-$A.tar.gz"
  curl -fsSL -o "/tmp/$F" "https://dist.ipfs.tech/kubo/$V/$F"
  SUM=$(curl -fsSL "https://dist.ipfs.tech/kubo/$V/$F.sha512" | awk '{print $1}')
  echo "$SUM  /tmp/$F" | sha512sum -c --quiet - || { echo "Kubo download failed its checksum"; exit 1; }
  tar -xzf "/tmp/$F" -C /tmp && install -m 755 /tmp/kubo/ipfs /usr/local/bin/ipfs && rm -rf "/tmp/$F" /tmp/kubo
fi

id ipfs >/dev/null 2>&1 || useradd --system --home "$IPFS_PATH" --shell /usr/sbin/nologin ipfs
if [ ! -f "$IPFS_PATH/config" ]; then
  mkdir -p "$IPFS_PATH" && chown ipfs:ipfs "$IPFS_PATH"
  runuser -u ipfs -- env IPFS_PATH="$IPFS_PATH" ipfs init --profile server >/dev/null
fi

if [ ! -f /etc/systemd/system/ipfs.service ]; then
  cat > /etc/systemd/system/ipfs.service <<UNIT
[Unit]
Description=IPFS node (Kubo), keeps Covenant releases online
After=network-online.target
Wants=network-online.target

[Service]
User=ipfs
Environment=IPFS_PATH=$IPFS_PATH
ExecStart=/usr/local/bin/ipfs daemon --migrate
Restart=always
RestartSec=10
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now ipfs >/dev/null 2>&1
fi
systemctl is-active --quiet ipfs || systemctl start ipfs
for _ in $(seq 1 30); do runuser -u ipfs -- env IPFS_PATH="$IPFS_PATH" ipfs id >/dev/null 2>&1 && break; sleep 1; done

chmod a+r "$CAR"
CID=$(runuser -u ipfs -- env IPFS_PATH="$IPFS_PATH" ipfs dag import --pin-roots "$PWD/$CAR" | awk '/Pinned root/ {print $3}' | head -1)
[ -n "$CID" ] || { echo "Import failed"; exit 1; }
cat <<MSG
Pinned $CID from $CAR on this server's IPFS node.
  https://$CID.ipfs.dweb.link/
It can take a few minutes before public gateways find it the first time.
For it to be reachable from outside, port 4001 (tcp+udp) must be open.
MSG
