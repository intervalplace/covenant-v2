"use client";

import Link from "next/link";

export default function About() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "64px 20px 80px" }}>

      <div style={{ marginBottom: 56 }}>
        <div className="faint">Covenant</div>
        <h1 style={{ fontSize: 38, lineHeight: 1.1, margin: "12px 0 0", fontFamily: "var(--serif)", fontWeight: "normal" }}>
          Execution no longer requires trust.
        </h1>
        <p className="muted" style={{ marginTop: 16, fontSize: 17, lineHeight: 1.7 }}>
          Covenant is a CSD/USDC market with no backend, no database, and no company
          server. Every piece of state (offers, authorizations, proofs, receipts)
          lives as a content-addressed object on AON, a peer-to-peer network.
          Settlement is enforced entirely by smart contracts. There is nothing in
          the middle.
        </p>
      </div>

      <div className="col" style={{ gap: 32 }}>

        {/* What it is */}
        <div className="card">
          <div className="faint" style={{ marginBottom: 12 }}>What it is</div>
          <p style={{ lineHeight: 1.8, color: "var(--muted)" }}>
            Most trading platforms hold your state in a database they control. Covenant
            holds no state at all. Every sell offer, every buyer authorization, every
            payment proof, every settlement receipt is a public object on AON: signed,
            content-addressed, and propagated across every node on the network. No
            Covenant server stores any of this. If Covenant shut down tomorrow, every
            object would still exist on the network and any executor could still settle
            outstanding trades directly against the contracts.
          </p>
          <p style={{ lineHeight: 1.8, color: "var(--muted)", marginTop: 12 }}>
            The market itself is CSD/USDC: trading CSD, the native token of Compute
            Substrate, for USDC on Ethereum. Settlement is enforced on-chain by a
            Compute Substrate light client: the USDC release is conditional on a
            verifiable payment proof. If the CSD payment didn't happen, the USDC
            doesn't move. No attestation. No oracle. No custody.
          </p>
        </div>

        {/* How a trade works */}
        <div className="card">
          <div className="faint" style={{ marginBottom: 16 }}>How a trade works</div>
          <div className="col" style={{ gap: 14 }}>
            {[
              ["Seller posts an offer", "The seller creates a sell offer on the network, specifying the CSD amount and the USDC price. The offer is a public object on the AON network, visible to anyone."],
              ["Buyer authorizes the trade", "The buyer signs an EIP-712 authorization committing to: the exact USDC amount, the exact CSD amount, and their CSD receive address. This signature is published to the AON network. The buyer can revoke the authorization at any time before the seller locks USDC. Once locked, the settlement proceeds automatically if valid CSD proof arrives within the 20-minute window."],
              ["Seller locks USDC", "When the seller is ready, they call the settlement contract directly from their wallet to lock the buyer's USDC. The contract verifies the buyer's signature, pulls the USDC (pre-approved by the buyer), and holds it in escrow for up to 20 minutes."],
              ["Seller sends CSD", "The seller sends the exact CSD amount to the buyer's address on the Compute Substrate network."],
              ["Proof submitted", "The CSD transaction is submitted as an SPV proof object to the AON network. The proof includes the raw transaction, the merkle path, and the block header."],
              ["Automatic settlement", "The executor verifies the proof on-chain: it checks that the transaction pays the correct amount to the correct address, that the transaction is in the block's merkle tree, and that the block meets the Compute Substrate network's proof-of-work target. If all checks pass, USDC is released to the seller."],
            ].map(([title, body], i) => (
              <div key={i} style={{ display: "flex", gap: 16 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                  background: "var(--surface2)", border: "1px solid var(--border2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, color: "var(--fg)", fontWeight: 600, marginTop: 1,
                }}>
                  {i + 1}
                </div>
                <div>
                  <div style={{ fontWeight: 500, marginBottom: 4 }}>{title}</div>
                  <div className="muted" style={{ fontSize: 14, lineHeight: 1.7 }}>{body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Security */}
        <div className="card">
          <div className="faint" style={{ marginBottom: 12 }}>Security</div>
          <div className="col" style={{ gap: 16 }}>
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>On-chain SPV verification</div>
              <div className="muted" style={{ fontSize: 14, lineHeight: 1.7 }}>
                The settlement contract verifies three things independently: that the raw
                CSD transaction pays the correct amount to the correct address, that the
                transaction appears in a block via merkle proof, and that the block meets
                the Compute Substrate proof-of-work target. Faking a valid proof requires
                mining a genuine Compute Substrate block. The cost is identical to honest mining.
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>100 USDC per trade limit</div>
              <div className="muted" style={{ fontSize: 14, lineHeight: 1.7 }}>
                The settlement contract enforces a hard cap of 100 USDC per trade.
                This limits exposure to 1-confirmation reorg risk on the Compute Substrate
                chain. The limit is in the contract, not the interface, so it cannot be bypassed. It will be raised as Compute Substrate hashrate grows
                and multi-confirmation settlement becomes practical.
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>No custody</div>
              <div className="muted" style={{ fontSize: 14, lineHeight: 1.7 }}>
                The settlement contract holds USDC only during the 20-minute lock window.
                If the CSD payment is not proven within that window, the USDC refunds to
                the buyer. At no point does any party, including Covenant, hold funds
                on behalf of another. There is no Covenant company with access to your funds.
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>No price oracle</div>
              <div className="muted" style={{ fontSize: 14, lineHeight: 1.7 }}>
                The price is agreed between buyer and seller in the authorization signature.
                The contract does not query any price feed. The only thing the contract
                verifies is that the CSD payment matches what the buyer committed to.
              </div>
            </div>
          </div>
        </div>

        {/* Powered by */}
        <div className="card">
          <div className="faint" style={{ marginBottom: 12 }}>What runs underneath</div>
          <div className="col" style={{ gap: 16 }}>
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>
                <a href="https://aon.network" target="_blank" rel="noreferrer">
                  AON: Authorization Object Network ↗
                </a>
              </div>
              <div className="muted" style={{ fontSize: 14, lineHeight: 1.7 }}>
                AON is the layer that makes Covenant possible without a backend. Every
                object in Covenant (sell offers, buyer authorizations, CSD payment
                proofs, settlement receipts) is published to AON as a content-addressed
                object and propagated across every connected node. Settlement is
                permissionless: any third party observing the network can run executor
                software and settle any valid trade. It does not have to be a party
                to the trade. Anyone can participate. The network runs across TCP/IP,
                WebSocket, LoRa, Bluetooth, and Reticulum simultaneously. When you look
                at the AON explorer and see the objects behind a completed trade, that is
                the entire record of what happened. Not a log in a database. Not
                something a company controls.
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>
                <a href="https://computesubstrate.org" target="_blank" rel="noreferrer">
                  Compute Substrate ↗
                </a>
              </div>
              <div className="muted" style={{ fontSize: 14, lineHeight: 1.7 }}>
                CSD is the native token of Compute Substrate, a permissionless public
                cognition layer. A Compute Substrate light client is deployed on Ethereum
                and tracks the CSD header chain, using the same SPV mechanism Bitcoin uses to
                verify payments without downloading the full chain. This is what makes the
                settlement trustless: the contract checks the actual proof-of-work, not
                an oracle's word.
              </div>
            </div>
          </div>
        </div>

        {/* Links */}
        <div className="card">
          <div className="faint" style={{ marginBottom: 12 }}>Explore</div>
          <div className="col" style={{ gap: 8 }}>
            {[
              ["AON Explorer", "https://explorer.aon.network", "View all objects on the live AON network"],
              ["AON on GitHub", "https://github.com/intervalplace/aon", "Node, SDK, namespaces"],
              ["Compute Substrate", "https://computesubstrate.org", "The CSD blockchain"],
            ].map(([label, href, desc]) => (
              <div key={href as string} className="row" style={{ gap: 12 }}>
                <a href={href as string} target="_blank" rel="noreferrer"
                  style={{ minWidth: 160, fontWeight: 500 }}>
                  {label} ↗
                </a>
                <span className="muted" style={{ fontSize: 14 }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="muted" style={{ fontSize: 13, textAlign: "center" }}>
          No cookies. No authority.
        </div>

      </div>

      <div style={{ marginTop: 48 }}>
        <Link href="/" style={{ color: "var(--muted)", fontSize: 14 }}>← Back to market</Link>
      </div>

    </main>
  );
}
