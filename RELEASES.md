# Releases

Every release is the same build in two places: [covenant.market](https://covenant.market)
and IPFS. Open a release by its CID through any IPFS gateway, e.g.
`https://<CID>.ipfs.dweb.link`, or a local IPFS node: `ipfs://<CID>`.
A CID can only ever serve that exact build. See [TRUST.md](TRUST.md) for how
to check one.

**CSD/USDC settlement contract (Ethereum mainnet, from v1.1.0):** `0x8863f0c477a30bb5a2077c813f42250d7fbefcb9` ([Etherscan](https://etherscan.io/address/0x8863f0c477a30bb5a2077c813f42250d7fbefcb9)), no owner; source in [aon-namespace-csd-usdc](https://github.com/intervalplace/aon-namespace-csd-usdc).

**Settlement contract (Ethereum mainnet):** `0x2b563632192BD8Ccace85aEF14a33607C3a0193D` ([Etherscan](https://etherscan.io/address/0x2b563632192BD8Ccace85aEF14a33607C3a0193D)). Deployed in tx `0x66e21e58af57729393cf60bf7cd8efca50e8fd94d382382c8fdc3e34c5fb2bf3`.

| Version | CID | Commit | Date | Notes |
|---|---|---|---|---|
| v1.1.0 | `bafybeiafwya5ikenzl5hypkvqxw5p5c67q5q7wq7w262blgqtsw6mc2z7a` | `fc4202eb849d` | 2026-10-30 | CSD/USDC: trade Compute Substrate (its own chain, no smart contracts) for USDC on Ethereum, wallet to wallet, through an open market of makers on AON. The ETH pair now trades against USDC. |
| v1.0.4 | `bafybeie27whot7pc6r2r4t6jeia6zx5vby6ckttzc3wjjp5hkmjoqxx3ga` | `b9cd061764b2` | 2026-10-25 | Approves exact amounts (the order plus your other open orders), never unlimited. Trades older than a week stay in Recent trades and Trade history. |
| v1.0.3 | `bafybeihgyrttb6duurrh6iksp7no4yz2mea3ubfprdb4olf4jvwlmn7dbq` | `dbe49f006582` | 2026-10-16 | Links the official @covenantmarket account in the footer and on the About page. |
| v1.0.2 | `bafybeihmbe3qm36sdmtp3t4qmbahrtiqzffkimnfq3gm4npghjvg45c5ya` | `180a5fb41481` | 2026-10-16 | After a trade settles, the message says so and links the Ethereum transaction and the AON receipt. |
| v1.0.1 | `bafybeiev75crxbykzvjzhoesblehpl54yqkkrcrlbpp3iah5pngv75arpq` | `a675dee4ce01` | 2026-10-16 | Accepts decimal commas in price and amount; keeps 0.002 ETH for gas when selling (was 0.01). |
| v1.0.0 | `bafybeifbmybmztbqkkolzfchwq432jbjpzjjtvkx3oiqiexejtxbkizywe` | `56891a85072c` | 2026-10-16 | First release. ETH/USDT on Ethereum mainnet. |
