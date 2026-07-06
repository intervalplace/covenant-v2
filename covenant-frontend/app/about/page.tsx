import Link from "next/link";

export default function About() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 20px 64px" }}>

      <p className="muted" style={{ marginBottom: 10 }}>About</p>
      <h1 style={{ fontWeight: 600, lineHeight: 1.15, marginBottom: 14 }}>
        Execution no longer requires trust.
      </h1>
      <p className="muted">
        Covenant is a CSD/USDC market with no backend, no database, and no company
        server holding your state. Settlement is enforced by smart contracts.
        There is nothing in the middle.
      </p>

      <hr style={{ margin: "34px 0", border: "none", borderTop: "1px solid #ddd" }} />

      <h2>What it is</h2>
      <p className="muted">
        Most trading platforms hold your state in a database they control. Covenant
        holds no state at all. Every sell offer, every buyer authorization, every
        payment proof, every settlement receipt is a public object on AON: signed,
        content-addressed, and propagated across every node on the network. No
        Covenant server stores any of this. If Covenant shut down tomorrow, every
        object would still exist on the network and any executor could settle
        outstanding trades directly against the contracts.
      </p>
      <p className="muted" style={{ marginTop: 16 }}>
        The market itself is CSD/USDC: trading CSD, the native unit of Compute
        Substrate, for USDC on Ethereum. Settlement is enforced on-chain by a
        Compute Substrate light client. The USDC release is conditional on a
        verifiable CSD payment proof. If the payment did not happen, the USDC
        does not move. No attestation. No oracle. No custody.
      </p>

      <hr style={{ margin: "34px 0", border: "none", borderTop: "1px solid #ddd" }} />

      <h2>How a trade works</h2>
      <ol style={{ paddingLeft: 22, color: "var(--muted)", lineHeight: 2.1, marginTop: 14 }}>
        <li>Seller creates a sell offer on the AON network, specifying the CSD amount, USDC price, and executor fee.</li>
        <li>Buyer selects the offer, enters their CSD receive address, and signs an EIP-712 authorization committing to the exact amounts. The authorization is published to AON. The buyer can revoke it any time before the seller locks USDC.</li>
        <li>When the seller is ready to send CSD, they lock the buyer's USDC directly from their wallet. The contract verifies the authorization signature and holds the USDC in escrow for 20 minutes.</li>
        <li>The seller sends CSD to the buyer's address on Compute Substrate.</li>
        <li>The seller submits the CSD transaction ID. An SPV proof is fetched and published as an object on AON.</li>
        <li>An executor finds the completed graph on AON and calls the settlement contract. The contract verifies the CSD payment proof independently and releases USDC to the seller.</li>
      </ol>

      <hr style={{ margin: "34px 0", border: "none", borderTop: "1px solid #ddd" }} />

      <h2>Security</h2>

      <h3 style={{ marginTop: 24 }}>On-chain SPV verification</h3>
      <p className="muted">
        The settlement contract verifies three things independently: that the raw
        CSD transaction pays the correct amount to the correct address, that the
        transaction appears in a block via merkle proof, and that the block meets
        the Compute Substrate proof-of-work target. Faking a valid proof requires
        mining a genuine Compute Substrate block. The cost is identical to honest mining.
      </p>

      <h3 style={{ marginTop: 24 }}>100 USDC per trade limit</h3>
      <p className="muted">
        The settlement contract enforces a hard cap of 100 USDC per trade.
        This limits exposure to 1-confirmation reorg risk on the Compute Substrate
        chain. The limit is in the contract, not the interface, so it cannot be
        bypassed. It will be raised as Compute Substrate hashrate grows.
      </p>

      <h3 style={{ marginTop: 24 }}>No custody</h3>
      <p className="muted">
        The settlement contract holds USDC only during the 20-minute lock window.
        If the CSD payment is not proven within that window, the USDC refunds to
        the buyer. At no point does any party, including Covenant, hold funds
        on behalf of another.
      </p>

      <h3 style={{ marginTop: 24 }}>No price oracle</h3>
      <p className="muted">
        The price is agreed between buyer and seller in the authorization signature.
        The contract does not query any price feed. It only verifies that the CSD
        payment matches what the buyer committed to.
      </p>

      <hr style={{ margin: "34px 0", border: "none", borderTop: "1px solid #ddd" }} />

      <h2>What runs underneath</h2>

      <h3 style={{ marginTop: 24 }}>
        <a href="https://aon.network" target="_blank" rel="noreferrer">AON: Authorization Object Network ↗</a>
      </h3>
      <p className="muted">
        AON is the layer that makes Covenant possible without a backend. Every object
        in Covenant is published to AON as a content-addressed object and propagated
        across every connected node. Settlement is permissionless: any third party
        observing the network can run executor software and settle any valid trade.
        It does not have to be a party to the trade. The network runs across TCP/IP,
        WebSocket, LoRa, Bluetooth, and Reticulum simultaneously. When you look at
        the AON explorer and see the objects behind a completed trade, that is the
        entire record of what happened. Not a log in a database. Not something a
        company controls.
      </p>

      <h3 style={{ marginTop: 24 }}>
        <a href="https://computesubstrate.org" target="_blank" rel="noreferrer">Compute Substrate ↗</a>
      </h3>
      <p className="muted">
        CSD is the native unit of Compute Substrate, a permissionless public
        cognition layer. A Compute Substrate light client deployed on Ethereum
        tracks the CSD header chain, using the same SPV mechanism Bitcoin uses to
        verify payments without downloading the full chain. This is what makes
        settlement trustless: the contract checks the actual proof-of-work, not
        an oracle's word.
      </p>

      <hr style={{ margin: "34px 0", border: "none", borderTop: "1px solid #ddd" }} />

      <h2>Explore</h2>
      <table style={{ marginTop: 14 }}>
        <tbody>
          {[
            ["AON Explorer", "https://explorer.aon.network", "View all objects on the live AON network"],
            ["AON on GitHub", "https://github.com/intervalplace/aon", "Node, SDK, namespaces"],
            ["Compute Substrate", "https://computesubstrate.org", "The CSD network"],
          ].map(([label, href, desc]) => (
            <tr key={href}>
              <td style={{ paddingRight: 24, whiteSpace: "nowrap" }}>
                <a href={href} target="_blank" rel="noreferrer">{label} ↗</a>
              </td>
              <td className="muted">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="muted" style={{ marginTop: 40, fontSize: 15 }}>
        <Link href="/">← Market</Link>
        {" · "}
        <Link href="/docs">Docs</Link>
        {" · "}
        No cookies. No authority.
      </p>

    </main>
  );
}
