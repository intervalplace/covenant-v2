# Covenant

Execution no longer requires trust.

CSD/USDC cross-chain trading powered by [AON](https://aon.network) and [Compute Substrate](https://computesubstrate.org).

## Architecture

```
User browser
    ↓
covenant-frontend  (Next.js/wagmi)
    ↓                    ↓
AON node           covenant-server
(explorer.aon.network)  (CSD proof proxy)
    ↓
csd-usdc executor (running on server)
    ↓
Ethereum mainnet
(CsdHeaderOracle + CsdUsdcSettlement)
```

## Packages

### `covenant-frontend`
Next.js app. All state lives in AON objects — no central backend.

```bash
cd covenant-frontend
npm install
cp .env.local.example .env.local
# Fill in contract addresses
npm run dev
```

### `covenant-server`
Thin Fastify server. Proxies CSD SPV proofs from Compute Substrate.
Also exposes `/v1/csd/proof/mock/:txid` for local testing.

```bash
cd covenant-server
npm install
cp .env.example .env
npm run dev
```

## Environment

See `covenant-frontend/.env.local.example` for all required variables.

Key ones:
- `NEXT_PUBLIC_SETTLEMENT_CONTRACT` — deployed CsdUsdcSettlement address
- `NEXT_PUBLIC_AON_NODE_URL` — defaults to https://explorer.aon.network
- `NEXT_PUBLIC_DEMO_MODE=true` — mock contract reads for UI testing

## Local testing with Hardhat

See `onchain-test/deploy-local.mjs` in the AON repo for contract deployment.
Set `NEXT_PUBLIC_CHAIN_ID=31337` and use Hardhat account private keys.
