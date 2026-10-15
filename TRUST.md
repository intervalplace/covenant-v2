# What you have to trust

Covenant is built so that nothing you rely on can be changed by anyone,
including its author. Here's each piece, what it can and can't do, and how to
check it.

## The settlement contract

The only thing that ever moves tokens. It has no owner, no admin functions and
no upgrade path, so its rules are fixed forever. It moves tokens only when it
has two valid signed orders whose terms are met, and it never holds your
tokens between trades.

Check it: the address in [RELEASES.md](RELEASES.md) is verified on
Etherscan, and `npm run check-deploy -- <address>` in `covenant-frontend`
compares the deployed bytecode with this repository's source.

## The website

The website can't move your tokens. The worst a website could do is show you a
bad order to sign, which is why the order form spells out your terms in plain
words and your wallet shows the exact values before you sign.

There are two ways to reach it:

- **[covenant.market](https://covenant.market)**: the convenient address.
  Like any domain, whoever controls it could change what it serves.
- **IPFS**: every release is published with an address (a CID) that is a
  hash of the build itself. A CID can only ever serve that exact build, and
  nobody can change it or take it down while anyone pins it. If the domain
  ever went away, every release would still be reachable by its CID.

The domain only ever serves a published release. You can check that it does:

- The site's footer shows the build it's running, linked to its entry in
  [RELEASES.md](RELEASES.md).
- Builds are reproducible: the same commit always gives the same CID. Check
  out a release commit, run `npm run release:ipfs` (it prints the CID), then
  `npm run check-site -- https://covenant.market` compares every file the
  domain serves with that build.

Ways to open a release by CID, from most to least independent:

- A local IPFS node, such as [IPFS Desktop](https://docs.ipfs.tech/install/ipfs-desktop/):
  `ipfs://<CID>`.
- Any public subdomain gateway, such as `https://<CID>.ipfs.dweb.link` or
  `https://<CID>.ipfs.w3s.link`.

Each CID (and the domain) is a separate site to your browser, so you connect
your wallet once per address and per-browser settings start fresh.

New versions are new releases with new CIDs. Old releases keep working, and
nobody can push a change into one.

## The order book

Orders, matches, cancellations and receipts live on
[AON](https://aon.network), an open network. Nobody runs the matching:
your browser matches your order against the book and publishes the result.
Everything is signed. A node could withhold orders from you, but it can't
forge or alter them, and the app can use several nodes. Under "Connections" in
the header you can add your own node and Ethereum RPC.

## Settling trades

Anyone can settle a match, and the contract doesn't care who sends it.
Executors are optional services that settle matches automatically, and anyone
can run one ([covenant-executor](covenant-executor/README.md)). If none is
running, or you're in a hurry, "Settle now" in the app settles your trade from
your own wallet.

## What is not covered

- **No professional audit.** The contract has been through review rounds and
  heavy testing ([security-tests](security-tests)), but no audit.
- **Ethereum and its tokens.** Covenant inherits the risks of Ethereum, WETH
  and USDT. USDT's issuer, for example, can freeze addresses.
- **Your wallet.** Check what you sign.
