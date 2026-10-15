# covenant-executor

Settles matched aon:evm-spot trades on Ethereum and publishes receipts.
Anyone can run one; running more than one is fine (the first to settle a
trade wins, the others see it settled and skip it; a rare same-block race costs the loser some gas).

It holds no trader funds. Every fill is checked by the settlement contract
against both traders' signatures, so an executor can't change a trade. It
only pays gas (~340k gas per settlement) and can earn the executor fee if
traders sign one.

## Run on a server

As root on Ubuntu/Debian:

```bash
apt-get install -y git
git clone https://github.com/intervalplace/covenant-v2 /opt/covenant
/opt/covenant/covenant-executor/deploy/install.sh      # creates /etc/covenant/executor.env
nano /etc/covenant/executor.env                        # fill in the three required values
/opt/covenant/covenant-executor/deploy/install.sh      # checks them and starts the service
```

- Logs: `journalctl -u covenant-executor -f`.
- Update to the latest code: `/opt/covenant/covenant-executor/deploy/update.sh`.

## Run locally

```bash
(cd ../aon-namespace-evm-spot && npm ci && npm run build)
npm ci
cp .env.example .env      # fill in the three required values
set -a; . ./.env; set +a
npm run check             # connects, checks the contract and balance, exits
npm start
```

## What it does differently from the SDK's runExecutor

It validates every object before evaluating: order and revocation
signatures, and receipts against the on-chain `SpotTradeSettled` event. The
stock loop evaluates raw objects, so a forged receipt or revocation could
make it skip real trades.

## Low balance

It logs `[LOW BALANCE]` (at start and every 30 min) when the wallet drops
below `MIN_ETH_BALANCE`. Use a fresh wallet with only a little ETH.
