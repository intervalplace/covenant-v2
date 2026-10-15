#!/usr/bin/env bash
# Covenant executor installer (Ubuntu/Debian). As root:
#
#   git clone https://github.com/intervalplace/covenant-v2 /opt/covenant
#   /opt/covenant/covenant-executor/deploy/install.sh
#
# First run: creates /etc/covenant/executor.env from the template and stops so
# you can fill it in. Second run: checks the settings and starts the
# executor as a systemd service (covenant-executor). Safe to re-run.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)."; exit 1; }
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
EXE="$REPO/covenant-executor"; NS="$REPO/aon-namespace-evm-spot"
[ -f "$EXE/executor.ts" ] && [ -d "$NS" ] || { echo "Run this from a clone of the covenant-v2 repo."; exit 1; }
case "$REPO" in /root/*|/home/*)
  echo "The executor runs as its own user and can't read $REPO. Clone to /opt/covenant instead:"
  echo "  git clone https://github.com/intervalplace/covenant-v2 /opt/covenant"; exit 1 ;;
esac

apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null
# One Node.js (22+) for everything: the dependencies are built with it and
# the service runs it. A system install is used if it's new enough (not one
# under /root or /home, which the service user can't read). If the server
# already has an older Node.js for other apps, a separate Node 22 goes into
# /opt/node22 and the system one is left alone.
pick_node() {
  for n in /opt/node22/bin/node /usr/bin/node /usr/local/bin/node; do
    [ -x "$n" ] && [ -x "$(dirname "$n")/npm" ] || continue
    [ "$("$n" -p 'process.versions.node.split(".")[0]')" -ge 22 ] && { echo "$n"; return 0; }
  done
  return 1
}
private_node22() {
  local a base sums file sum
  case "$(uname -m)" in x86_64) a=x64 ;; aarch64|arm64) a=arm64 ;; *) echo "Unsupported CPU: $(uname -m)"; exit 1 ;; esac
  apt-get install -y -qq xz-utils >/dev/null
  base=https://nodejs.org/dist/latest-v22.x
  sums=$(curl -fsSL "$base/SHASUMS256.txt")
  file=$(awk -v s="-linux-$a.tar.xz" 'substr($2, length($2)-length(s)+1) == s {print $2; exit}' <<<"$sums")
  sum=$(awk -v f="$file" '$2 == f {print $1}' <<<"$sums")
  [ -n "$file" ] && [ -n "$sum" ] || { echo "Couldn't find Node 22 for linux-$a"; exit 1; }
  curl -fsSL -o "/tmp/$file" "$base/$file"
  echo "$sum  /tmp/$file" | sha256sum -c --quiet - || { echo "Node download failed its checksum"; exit 1; }
  rm -rf /opt/node22 && mkdir -p /opt/node22 && tar -xJf "/tmp/$file" -C /opt/node22 --strip-components=1 && rm -f "/tmp/$file"
}
NODE_BIN=$(pick_node || true)
if [ -z "$NODE_BIN" ]; then
  if command -v node >/dev/null || [ -x /usr/bin/node ]; then
    echo "This server has Node.js $(node -v 2>/dev/null || /usr/bin/node -v) for other apps; installing a separate Node 22 in /opt/node22"
    private_node22
  else
    echo "Installing Node.js 22"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
  fi
  NODE_BIN=$(pick_node) || { echo "Couldn't set up Node.js 22."; exit 1; }
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"
echo "node $("$NODE_BIN" -v) at $NODE_BIN"

echo "Building the namespace and installing the executor"
(cd "$NS" && rm -rf node_modules && npm ci --no-audit --no-fund --loglevel=error && npm run -s build)
(cd "$EXE" && rm -rf node_modules && npm ci --no-audit --no-fund --loglevel=error)
chmod -R a+rX "$REPO"

id covenant >/dev/null 2>&1 || useradd --system --home /var/lib/covenant --shell /usr/sbin/nologin covenant
mkdir -p /etc/covenant
ENV=/etc/covenant/executor.env
if [ ! -f "$ENV" ]; then
  cp "$EXE/.env.example" "$ENV"
  chown root:covenant "$ENV"; chmod 640 "$ENV"
  cat <<MSG

Created $ENV. Fill in the three required values:
  AON_EVM_RPC_URL, AON_EXECUTOR_PRIVATE_KEY, AON_EVM_SPOT_SETTLEMENT_CONTRACT
with:  nano $ENV
then run this script again.
MSG
  exit 0
fi
if grep -qE '^(AON_EXECUTOR_PRIVATE_KEY=0x\.\.\.|AON_EVM_SPOT_SETTLEMENT_CONTRACT=0x\.\.\.|AON_EVM_RPC_URL=.*YOUR_KEY)' "$ENV"; then
  echo "$ENV still has placeholder values. Edit it (nano $ENV), then run this again."; exit 1
fi
chown root:covenant "$ENV"; chmod 640 "$ENV"

echo "Checking settings"
runuser -u covenant -- env -i PATH="$PATH" HOME=/var/lib/covenant bash -c "set -a; . '$ENV'; cd '$EXE' && '$NODE_BIN' --import tsx executor.ts --check"

cat > /etc/systemd/system/covenant-executor.service <<UNIT
[Unit]
Description=Covenant executor (aon:evm-spot)
After=network-online.target
Wants=network-online.target

[Service]
User=covenant
WorkingDirectory=$EXE
EnvironmentFile=$ENV
ExecStart=$NODE_BIN --import tsx executor.ts
Restart=always
RestartSec=10
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable covenant-executor >/dev/null 2>&1
systemctl restart covenant-executor
sleep 3
systemctl is-active --quiet covenant-executor && echo "Executor running. Logs: journalctl -u covenant-executor -f" || { echo "It didn't start. See: journalctl -u covenant-executor -n 50"; exit 1; }
