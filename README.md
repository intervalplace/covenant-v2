# Covenant

Execution no longer requires trust.

A spot exchange for ETH/USDT, LINK/USDT and QNT/USDT on Ethereum, powered by
[AON](https://aon.network). Limit and market orders, a live order book and
partial fills, with no deposits, no backend and no database.

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

### `covenant-server`
The old CSD SPV-proof proxy. Not used by the EVM markets; kept for the
CSD/USDC market if it returns.

## Going live

1. Deploy `AonEvmSpotSettlement` from
   `aon-namespace-evm-spot/src/contracts/GenericEvmSpotSettlement.sol`
   with one constructor argument: the WETH address
   (`0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` on mainnet). Compile with
   the optimizer and `viaIR: true` (it doesn't fit the legacy pipeline's
   stack). Set `NEXT_PUBLIC_EVM_SPOT_SETTLEMENT`.
2. Run an executor for the `aon:evm-spot` namespace (the existing executor
   only handles `aon:csd-usdc`):

   ```ts
   import { registerNamespace, runExecutor } from "@intervalplace/aon-sdk";
   import { evmSpotNamespace } from "@intervalplace/namespace-evm-spot";

   registerNamespace(evmSpotNamespace);
   // env: AON_EVM_RPC_URL, AON_EXECUTOR_PRIVATE_KEY (needs ETH for gas)
   // Recommended: pin the contract so the executor only ever calls it
   //   AON_EVM_SPOT_SETTLEMENT_CONTRACT=0x...
   await runExecutor({
     nodeUrl: "https://explorer.aon.network",
     namespace: "aon:evm-spot",
     mode: "contract",
     pollIntervalMs: 3000,
   });
   ```

## Notes

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
  contract (`usedFillNonce`, `filledBaseByOrder`), not from AON receipts.
- Requires the patched `aon-namespace-evm-spot` (verified revocations and
  receipts, failure backoff). See that repo's CHANGES.md.
