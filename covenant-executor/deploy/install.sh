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

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "Installing Node.js 22"
  apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

echo "Building the namespace and installing the executor"
(cd "$NS" && npm ci --no-audit --no-fund --loglevel=error && npm run -s build)
(cd "$EXE" && npm ci --no-audit --no-fund --loglevel=error)
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
runuser -u covenant -- env -i PATH="$PATH" HOME=/var/lib/covenant bash -c "set -a; . '$ENV'; cd '$EXE' && node --import tsx executor.ts --check"

cat > /etc/systemd/system/covenant-executor.service <<UNIT
[Unit]
Description=Covenant executor (aon:evm-spot)
After=network-online.target
Wants=network-online.target

[Service]
User=covenant
WorkingDirectory=$EXE
EnvironmentFile=$ENV
ExecStart=/usr/bin/env node --import tsx executor.ts
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
