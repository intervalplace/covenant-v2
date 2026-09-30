import Link from "next/link";

const hr = <hr style={{ margin: "34px 0", border: "none", borderTop: "1px solid #ddd" }} />;

export default function About() {
  return (
    <main className="prose" style={{ maxWidth: 720, margin: "0 auto", padding: "56px 24px 24px" }}>

      <p className="prose-kicker" style={{ marginBottom: 12 }}>How it works</p>
      <h1 style={{ fontWeight: 600, lineHeight: 1.15, marginBottom: 14 }}>
        Execution no longer requires trust.
      </h1>
      <p className="muted">
        Covenant is an order book for trading ETH, LINK and QNT against USDT on
        Ethereum, with no backend, no database and no custody. It works like the
        order book you know from any exchange. The difference is that there is
        no exchange.
      </p>

      {hr}

      <h2>What it is</h2>
      <p className="muted">
        On a normal exchange you deposit funds and the exchange matches orders in
        its own database. On Covenant nothing is deposited. An order is a message
        you sign in your wallet: "I will sell up to 0.5 ETH at 3,010 USDT or better,
        for the next 24 hours." That message is published to AON, a peer-to-peer
        network, and your tokens stay in your wallet.
      </p>
      <p className="muted" style={{ marginTop: 16 }}>
        When two signed orders cross, a settlement contract on Ethereum checks both
        signatures and swaps the tokens directly between the two wallets in a single
        transaction. Either both sides move or neither does. Your tokens can only
        ever move on terms you signed.
      </p>

      {hr}

      <h2>How a trade works</h2>
      <ol style={{ paddingLeft: 22, color: "var(--muted)", lineHeight: 2.1, marginTop: 14 }}>
        <li>Choose a market, a side, a price and an amount. The first time, you approve the token for the settlement contract.</li>
        <li>You sign two messages, with no gas: an authorization that caps what the order can spend, and the order itself.</li>
        <li>If your price crosses the book, the order fills right away against the best prices first, at each resting order's price.</li>
        <li>Whatever doesn't fill rests on the book as a limit order until it fills, you cancel it, or it expires after 24 hours. Market orders never rest.</li>
        <li>An executor picks up each matched fill from AON and submits it to the settlement contract, which swaps the tokens and records how much of each order is filled.</li>
      </ol>

      {hr}

      <h2>Security</h2>

      <h3 style={{ marginTop: 24 }}>Bounded authorizations</h3>
      <p className="muted">
        Every order comes with its own authorization that fixes the market, the
        side, the maximum amount, the price limit and an expiry. The contract
        rejects anything outside those bounds, so the worst case for any order is
        exactly what you signed.
      </p>

      <h3 style={{ marginTop: 24 }}>No custody</h3>
      <p className="muted">
        Tokens are never deposited. They move straight from seller to buyer at the
        moment of settlement. Your approval lets the settlement contract move tokens
        only when it has a valid signed order from you.
      </p>

      <h3 style={{ marginTop: 24 }}>No operator</h3>
      <p className="muted">
        There is no company or server in the middle: nothing that holds your
        funds, approves your trades or can freeze an account. Orders live on AON,
        matching happens in your browser, and settlement is a public contract
        anyone can call. The contract has no owner and no admin functions, so
        nobody can pause it, upgrade it or redirect it.
      </p>
      <p className="muted" style={{ marginTop: 12 }}>
        This website is just one way in. It can't move your tokens. What any
        interface could do is show you a bad order to sign, which is why the
        order form spells out your terms in plain words before you sign, and your
        wallet shows the exact values before you approve.
      </p>

      <h3 style={{ marginTop: 24 }}>Partial fills, enforced on-chain</h3>
      <p className="muted">
        The contract keeps a running total of how much of each order has filled
        and refuses any fill that would exceed it, however many executors are
        running and in whatever order they submit.
      </p>

      <h3 style={{ marginTop: 24 }}>Atomic settlement</h3>
      <p className="muted">
        Both legs of a trade live on Ethereum and move in the same transaction.
        There is no window where one side has paid and the other hasn't, so there
        is nothing for a reorg or a failed counterparty to exploit.
      </p>

      {hr}

      <h2>What runs underneath</h2>
      <h3 style={{ marginTop: 24 }}>
        <a href="https://aon.network" target="_blank" rel="noreferrer">AON: Authorization Object Network ↗</a>
      </h3>
      <p className="muted">
        Every order, fill, cancellation and settlement receipt is a signed,
        content-addressed object on AON, propagated across every connected node.
        Settlement is permissionless: anyone can run an executor and settle matched
        fills. If this website disappeared tomorrow, every order would still exist
        on the network and could still be settled against the contract.
      </p>

      {hr}

      <h2>Explore</h2>
      <table style={{ marginTop: 14 }}>
        <tbody>
          {[
            ["AON Explorer", "https://explorer.aon.network", "View all objects on the live AON network"],
            ["AON on GitHub", "https://github.com/intervalplace/aon", "Node, SDK, namespaces"],
          ].map(([label, href, desc]) => (
            <tr key={href}>
              <td style={{ paddingRight: 24, whiteSpace: "nowrap" }}><a href={href} target="_blank" rel="noreferrer">{label} ↗</a></td>
              <td className="muted">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="prose-kicker" style={{ marginTop: 40 }}>
        <Link href="/">← Back to trading</Link>{"  "}<Link href="/docs" style={{ marginLeft: 18 }}>Docs</Link>
      </p>
    </main>
  );
}
