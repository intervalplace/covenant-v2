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
| v1.1.4 | `bafybeibvldv7fohqbyxcxxredp52eclchjb2nvkcdj3us4fbqjigco4a6e` | `1811720c8e92` | 2026-10-31 | CSD/USDC: a buy's CSD shows in your balance within seconds, as unconfirmed (the market maker's published payment, checked against an independent CSD node); a sale's USDC shows as arriving; a seller's own claim includes enough blocks for the contract. |
| v1.1.3 | `bafybeidscppbevpjri4cmjncsdc2ubu3ujmiwde3buucefvqxu7fmubjzu` | `a7bf8191ac73` | 2026-10-31 | CSD/USDC: a sale shows as sold as soon as Ethereum has it final (the page checks a few times); plainer wording if a market maker doesn't release. |
| v1.1.2 | `bafybeibnmsjuxxb2xfxbjj2vw3qlb72tvonakfzgujgfirudvbjtp3u3hy` | `9112021a4175` | 2026-10-31 | CSD/USDC: a price chart from the market makers' signed offers, the average price and the price after your trade, step-by-step progress, and declined trades shown as "Not traded". |
| v1.1.1 | `bafybeif7d3cgt3jkjorfamfff6wdyypgolk3vh7whhlz7xi2udbgzisble` | `de3b7c5fa7a0` | 2026-10-31 | CSD/USDC: says when a trade is below the smallest or above the largest size; a rejected lock only skips the market maker for two minutes. |
| v1.1.0 | `bafybeiafwya5ikenzl5hypkvqxw5p5c67q5q7wq7w262blgqtsw6mc2z7a` | `fc4202eb849d` | 2026-10-30 | CSD/USDC: trade Compute Substrate (its own chain, no smart contracts) for USDC on Ethereum, wallet to wallet, through an open market of makers on AON. The ETH pair now trades against USDC. |
| v1.0.4 | `bafybeie27whot7pc6r2r4t6jeia6zx5vby6ckttzc3wjjp5hkmjoqxx3ga` | `b9cd061764b2` | 2026-10-25 | Approves exact amounts (the order plus your other open orders), never unlimited. Trades older than a week stay in Recent trades and Trade history. |
| v1.0.3 | `bafybeihgyrttb6duurrh6iksp7no4yz2mea3ubfprdb4olf4jvwlmn7dbq` | `dbe49f006582` | 2026-10-16 | Links the official @covenantmarket account in the footer and on the About page. |
| v1.0.2 | `bafybeihmbe3qm36sdmtp3t4qmbahrtiqzffkimnfq3gm4npghjvg45c5ya` | `180a5fb41481` | 2026-10-16 | After a trade settles, the message says so and links the Ethereum transaction and the AON receipt. |
| v1.0.1 | `bafybeiev75crxbykzvjzhoesblehpl54yqkkrcrlbpp3iah5pngv75arpq` | `a675dee4ce01` | 2026-10-16 | Accepts decimal commas in price and amount; keeps 0.002 ETH for gas when selling (was 0.01). |
| v1.0.0 | `bafybeifbmybmztbqkkolzfchwq432jbjpzjjtvkx3oiqiexejtxbkizywe` | `56891a85072c` | 2026-10-16 | First release. ETH/USDT on Ethereum mainnet. |
