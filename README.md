# Covenant

Execution no longer requires trust.

An order book without the exchange: spot trading on Ethereum, launching with
ETH/USDT, on [AON](https://aon.network). Limit and market orders, a live order
book and partial fills, with no deposits, no backend and no database.

Covenant is one example interface on AON. The order format, matching rules and
settlement contract are open; any other interface (or script) can place and
fill orders in the same book, and anyone can run an executor.

## How it works

```
User browser (covenant-frontend)
   │  signs authorization + order (EIP-712, no gas)
   │  matches against the book locally, publishes fills
   ▼
AON node  ──  every order, fill, cancel, receipt is an AON object
   ▲
   │  polls for executable fills
evm-spot executor
   │
   ▼
AonEvmSpotSettlement (Ethereum)  ──  verifies both sides, swaps tokens wallet-to-wallet
```

- One signed order can fill against several price levels, then rest on the
  book and be filled later as a maker. The contract tracks fills per order.
- Fills execute at the resting order's price (price-time priority).
- Tokens never leave the trader's wallet until settlement.

## Packages

### `covenant-frontend`
Next.js app.

```bash
cd covenant-frontend
npm install
cp .env.local.example .env.local   # set NEXT_PUBLIC_EVM_SPOT_SETTLEMENT
npm run dev
```

### `covenant-executor`
A ready-to-run executor (settles matched trades, publishes receipts). See its
README. Optional: traders can always settle their own trades from the app.

### `security-tests`
PoC tests for every contract review finding plus the main flows (106 checks).
`cd security-tests && npm install && ./run.sh`.

### `covenant-server`
The old CSD SPV-proof proxy. Not used by the EVM markets; kept for the
CSD/USDC market if it returns.

## Hosting: static, IPFS-ready

The frontend is a fully static site (`output: "export"` → `covenant-frontend/out`).
There is no server code, so it can be hosted anywhere: a plain web server,
any static host, or IPFS.

```bash
cd covenant-frontend
npm ci
npm run build          # -> out/
npm start              # serves out/ on :3000 (next start no longer applies)
```

### Publishing to IPFS

```bash
npm run release:ipfs                                   # build, pack, print the CID
IPFS_API=http://127.0.0.1:5001 npm run release:ipfs   # ...and pin on your IPFS node
```

This writes `release/covenant-<commit>.car` (the whole site as one
content-addressed archive) and `release/covenant-<commit>.json` (CID, commit,
date). Then:

1. **Pin it in several places.** Upload the `.car` to one or more pinning
   services, or `ipfs dag import release/covenant-<commit>.car` on any node.
   Anyone else can pin the CID too.
2. **The CID is the address.** No ENS name, no name gateway: those put a
   party in the middle that serves content nobody verifies. Open it through
   an IPFS gateway with the CID in the URL, ideally one that verifies every
   block against the CID in the browser. See DECENTRALIZE.md.
3. **Publish the CID with each release.**

Builds are reproducible: the build id is the git commit, so the same commit
always produces the same CID. To verify a release, check out its commit, run
`npm run release:ipfs` with the same `NEXT_PUBLIC_*` values, and compare.

Use a subdomain gateway (`<cid>.ipfs.dweb.link`), not
path-style `/ipfs/<cid>/` URLs: the site expects to be served from the root
of its origin, and subdomain gateways also give each site its own storage.

### No single backend

The site only talks to an AON node (the order book) and an Ethereum RPC.
Both have fallbacks, tried in order:

- AON: `NEXT_PUBLIC_AON_NODE_URL`, then `NEXT_PUBLIC_AON_NODE_FALLBACKS`
  (comma-separated). Run your own AON node and list it here.
- RPC: `NEXT_PUBLIC_ETH_RPC_URL`, `NEXT_PUBLIC_ETH_RPC_FALLBACKS`, then public
  defaults.

Users can also set their own node and RPC under "Network live" → Connections
in the site header. That's saved in their browser and takes priority.

## Rehearse on a mainnet fork (before deploying)

Runs the real contract, Covenant's order code and the real executor code
against real WETH, USDT and Chainlink on a local fork. No real funds, no real
transactions, nothing published to AON.

```bash
# once: install Foundry (provides anvil)
curl -L https://foundry.paradigm.xyz | bash && foundryup

cd covenant-frontend
npm ci
FORK_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/<key> npm run rehearse
```

It deploys with the exact production compiler settings, checks the Chainlink
price, sweeps two price levels with a native-ETH payout, confirms a
front-running attempt is rejected, tests Cancel on-chain, and prints the
settlement gas cost at today's gas price plus the settings to deploy with.
Any failure stops it with a non-zero exit. Don't deploy until it passes.

## Operatorless setup

See [DECENTRALIZE.md](DECENTRALIZE.md): immutable IPFS releases (each CID is
one build, forever, addressed by its CID with no domain or names in between),
link previews from an immutable brand bundle (`npm run release:brand`),
multiple AON nodes, and no required executor. The footer shows the CID the
app is running from.

`covenant-frontend/test/` holds the end-to-end harnesses used during
development (they expect locally compiled contracts). `npm run rehearse` is
the one to run before deploying.

## Going live

1. Deploy `AonEvmSpotSettlement` from
   `aon-namespace-evm-spot/src/contracts/GenericEvmSpotSettlement.sol`
   with one constructor argument: the WETH address
   (`0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` on mainnet). Compile with
   the optimizer and `viaIR: true` (it doesn't fit the legacy pipeline's
   stack). Set `NEXT_PUBLIC_EVM_SPOT_SETTLEMENT`.
2. Run an executor: `covenant-executor/` (see its README). Don't use the
   SDK's stock `runExecutor` for this namespace: it evaluates objects without
   validating them, so forged receipts or revocations could make it skip real
   trades.

Step by step, with exact commands: [LAUNCH.md](LAUNCH.md).

## Notes

- Scale: the app reads the whole namespace from the AON node (up to 50k
  objects). Fine for launch; past that it needs node-side filtering (e.g. only
  live orders).

- Launches with ETH/USDT only. LINK/USDT and QNT/USDT are defined; list them
  with `NEXT_PUBLIC_MARKETS=ETH-USDT,LINK-USDT` when the first book is busy.
- Front-running protection: an order that fills immediately signs the resting
  orders it matched and exactly how much it takes from each (`counterSetHash`
  over `[{orderHash, maxBase}]`, published as `counterSet`). Before
  `exclusiveUntil` (5 min; a market order's whole life), each named leg fills
  up to `maxBase` in total, at exactly its price, and nobody else can trade
  with the order until those legs are done. Fills with anyone else are capped
  at `baseAmount - exclusiveBase`, so an unfilled reserved part is void after
  the window and never opens up at the limit.
- Executor fee: `NEXT_PUBLIC_EXECUTOR_FEE_BPS`, basis points of each fill's
  quote amount, paid by the buyer. The contract caps fees pro-rata to fill
  size. Default 0.
- A fill that asks for more than is left settles what's left (same price, fee
  scaled down) instead of reverting; the receipt reports what actually moved.
- Minimum order 25 USDT (`NEXT_PUBLIC_MIN_ORDER_QUOTE`). A native-ETH
  settlement measured ~340k gas.

- Market reference prices come from the Chainlink Feed Registry on mainnet
  (`0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf`), read through the app's RPC
  (`NEXT_PUBLIC_ETH_RPC_URL`). Markets without a Chainlink feed show no
  reference and no off-market warnings.

- ETH/USDT uses native ETH at the edges: buy orders set `receiveNative`, and
  the contract unwraps WETH and pays the buyer ETH during settlement. Sellers
  must hold WETH at settlement (a signed order can't pull native ETH), so the
  interface wraps any shortfall before signing and keeps 0.01 ETH for gas.
  Wallets with contract code get WETH instead of ETH.

- The contract prices in quote-per-base scaled by 1e18 and assumes an
  18-decimal base token. WETH, LINK and QNT qualify; check before adding pairs.
- USDT's `approve` reverts when changing one nonzero allowance to another;
  the interface resets to 0 first.
- No order size cap by default. `NEXT_PUBLIC_MAX_ORDER_QUOTE` adds an
  interface-only cap if you want one while the contract is unaudited.
- "Cancel" is a free AON revocation that all executors honour. "Cancel
  on-chain" also calls `revokeAuthorization`, so nobody can settle the order.
- With an RPC available, the interface takes settlement status from the
  contract (`usedFill`, `filledBaseByOrder`, `boundFilledBase`), not from AON receipts.
- Requires the patched `aon-namespace-evm-spot`, vendored at the repo root
  (`aon-namespace-evm-spot/`; verified revocations and
  receipts, failure backoff). See that repo's CHANGES.md.
