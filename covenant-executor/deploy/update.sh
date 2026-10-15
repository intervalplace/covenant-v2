#!/usr/bin/env bash
# Pull the latest covenant-v2 code and restart the executor.
#   /opt/covenant/covenant-executor/deploy/update.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)."; exit 1; }
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
git -C "$REPO" pull --ff-only
NODE_BIN=$(sed -n 's/^ExecStart=\([^ ]*\) .*/\1/p' /etc/systemd/system/covenant-executor.service)
[ -x "$NODE_BIN" ] && export PATH="$(dirname "$NODE_BIN"):$PATH"
(cd "$REPO/aon-namespace-evm-spot" && npm ci --no-audit --no-fund --loglevel=error && npm run -s build)
(cd "$REPO/covenant-executor" && npm ci --no-audit --no-fund --loglevel=error)
chmod -R a+rX "$REPO"
systemctl restart covenant-executor && echo "Updated to $(git -C "$REPO" rev-parse --short HEAD) and restarted."
