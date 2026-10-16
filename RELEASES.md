# Releases

Every release is the same build in two places: [covenant.market](https://covenant.market)
and IPFS. Open a release by its CID through any IPFS gateway, e.g.
`https://<CID>.ipfs.dweb.link`, or a local IPFS node: `ipfs://<CID>`.
A CID can only ever serve that exact build. See [TRUST.md](TRUST.md) for how
to check one.

**Settlement contract (Ethereum mainnet):** `0x2b563632192BD8Ccace85aEF14a33607C3a0193D` ([Etherscan](https://etherscan.io/address/0x2b563632192BD8Ccace85aEF14a33607C3a0193D)). Deployed in tx `0x66e21e58af57729393cf60bf7cd8efca50e8fd94d382382c8fdc3e34c5fb2bf3`.

| Version | CID | Commit | Date | Notes |
|---|---|---|---|---|
| v1.0.1 | `bafybeickhasanwbjpvxt55py4lpb43kvx2xlejtxoqqwsoqk47pa7mwcua` | `32c71134b8d4` | 2026-10-16 | Accepts decimal commas in price and amount; keeps 0.002 ETH for gas when selling (was 0.01). |
| v1.0.0 | `bafybeifbmybmztbqkkolzfchwq432jbjpzjjtvkx3oiqiexejtxbkizywe` | `56891a85072c` | 2026-10-16 | First release. ETH/USDT on Ethereum mainnet. |
