# Covenant

**Execution no longer requires trust.**

An order book without the exchange. Trade ETH for USDT on Ethereum from your
own wallet: limit and market orders, a live order book, partial fills. There
are no deposits, no accounts and no backend. Your tokens stay in your wallet
until a trade settles, and they only ever move on terms you signed.

- **Use it:** [covenant.market](https://covenant.market). Every release is
  also on IPFS, where nobody can change it; see [RELEASES.md](RELEASES.md).
- **Learn how it works:** [covenant.market/about](https://covenant.market/about)
  and [covenant.market/docs](https://covenant.market/docs).
- **Settlement contract:** [RELEASES.md](RELEASES.md) has the address,
  verified on Etherscan.

> **Not audited.** The contract has been reviewed and heavily tested (see
> [security-tests](security-tests)), but has had no professional audit. Start
> small.

## How it works

```
Your wallet ── signs an order (free, no gas) ──▶ AON (an open network of orders)
                                                    │
                     two orders cross ──────────────┘
                                                    ▼
          Settlement contract on Ethereum: checks both signatures,
          swaps the tokens wallet to wallet in one transaction
```

1. An order is a message you sign: "sell up to 0.5 ETH at 3,010 USDT or
   better, for 24 hours". It's published to [AON](https://aon.network), and
   your tokens don't move.
2. When a new order crosses one in the book, your browser does the matching
   and publishes the match.
3. Anyone can settle a match. The settlement contract checks both signed
   orders and swaps the tokens directly between the two wallets. Either both
   sides move or neither does.

Matching happens at the resting order's price, and one order can fill across
several price levels. Whatever doesn't fill rests in the book.

## What you have to trust

As little as possible. See [TRUST.md](TRUST.md) for the full picture. In short:

- **The contract** has no owner, no admin functions and no upgrade path.
  Nobody can pause it, change it or move your tokens with it.
- **The website** can't move your tokens either. The worst a website could do
  is show you a bad order to sign, so your terms are spelled out in plain words
  and your wallet shows the exact values before you sign. Each release is
  reproducible and published on IPFS, so you can check what you're running.
- **Settling trades** doesn't depend on anyone. Executors are optional and
  anyone can run one, and you can always settle your own trade from the app.

Covenant is one example interface on AON. The order format, matching rules
and settlement contract are open, so anyone can build another interface on
the same book.

## Repository

| Folder | What |
|---|---|
| `covenant-frontend` | The web app. Static Next.js export, no server. |
| `covenant-executor` | A ready-to-run executor: settles matched trades and publishes receipts. |
| `aon-namespace-evm-spot` | The `aon:evm-spot` namespace (order rules, validation, executor logic) and the settlement contract, `src/contracts/GenericEvmSpotSettlement.sol`. |
| `security-tests` | Proof-of-concept tests for every issue found in review, plus the main flows. |
| `deploy` | The contract's compiler settings, Etherscan verification input, and `deploy.html`: a one-page deployer for any EIP-1193 wallet (`node deploy/build-deploy-page.mjs` rebuilds it from the verification input). |

### Run the app locally

```bash
cd covenant-frontend
npm ci
cp .env.local.example .env.local   # set NEXT_PUBLIC_EVM_SPOT_SETTLEMENT
npm run dev
```

### Verify a release

The same commit always builds the same IPFS CID. To check a release in
[RELEASES.md](RELEASES.md):

```bash
git checkout <release commit>
cd covenant-frontend && npm ci
npm run release:ipfs                              # prints the CID: compare it
npm run check-site -- https://covenant.market     # the domain serves exactly this build
```

To check the deployed contract against the source:
`ETH_RPC_URL=<rpc> npm run check-deploy -- <contract address>`.

### Run an executor

Executors pay gas to settle matched trades, and earn the executor fee if
there is one. See [covenant-executor](covenant-executor/README.md).

### Run the tests

```bash
cd security-tests && npm install && ./run.sh     # needs Foundry's anvil
```

`covenant-frontend`: `FORK_RPC_URL=<mainnet rpc> npm run rehearse` runs the
contract against real WETH, USDT and Chainlink on a local mainnet fork.

## Technical notes

- **Markets.** ETH/USDT is listed. LINK/USDT and QNT/USDT are defined
  (`NEXT_PUBLIC_MARKETS`). The contract assumes an 18-decimal base token.
- **Native ETH.** Buyers receive native ETH: the contract unwraps WETH during
  settlement. Wallets that are contracts get WETH. Sellers' ETH is wrapped
  before signing, because a signed order can't pull native ETH.
- **Front-running protection.** An order that fills immediately signs which
  resting orders it matched and how much it takes from each. Until those parts
  fill (5 minutes, or a market order's whole life), the contract only lets it
  trade with those orders at their prices. A matched part that never fills is
  void and never opens up at the order's limit.
- **Partial fills.** The contract keeps a running total per order. A fill that
  asks for more than is left settles what's left, at the same price.
- **Executor fee.** Paid by the buyer, in basis points of each fill
  (`NEXT_PUBLIC_EXECUTOR_FEE_BPS`), capped by the contract in proportion to
  fill size. Each settlement costs ~340k gas.
- **Cancelling.** "Cancel" is a free signed revocation that executors and the
  app honour. "Cancel on-chain" also revokes it in the contract.
- **Reference price.** From the Chainlink Feed Registry
  (`0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf`), with off-market warnings.
- **No single backend.** The app talks only to an AON node and an Ethereum
  RPC, each with fallbacks. Visitors can set their own under "Connections" in
  the header, and the wallet can act as the RPC.
- **Scale.** The app reads the order book from AON in full (up to 50k
  objects).
- **Releasing.** See [RELEASING.md](RELEASING.md).
