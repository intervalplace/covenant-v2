#!/bin/bash
# Usage: ./run.sh [review|bind|selfsettle|exec ...]   (default: all)
# Each suite gets a fresh anvil on :8545 (some suites move the chain clock).
set -e
cd "$(dirname "$0")"
command -v anvil >/dev/null || { echo "Install Foundry (anvil): https://getfoundry.sh"; exit 1; }
node compile.cjs
./sync.sh
suites=("$@"); [ ${#suites[@]} -eq 0 ] && suites=(review bind selfsettle exec)
for s in "${suites[@]}"; do
  anvil --port 8545 --silent & pid=$!
  sleep 2
  echo; echo "=== $s ==="
  if npx tsx "$s.test.mts"; then kill $pid; wait $pid 2>/dev/null || true
  else kill $pid; wait $pid 2>/dev/null || true; echo "✗ $s failed"; exit 1; fi
done
echo; echo "All suites passed."
