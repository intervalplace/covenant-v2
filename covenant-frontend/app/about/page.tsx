"use client";

import Link from "next/link";

export default function About() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "64px 20px 80px" }}>

      <div style={{ marginBottom: 56 }}>
        <div className="faint">Covenant</div>
        <h1 style={{ fontSize: 40, lineHeight: 1.1, margin: "12px 0 0" }}>
          Execution no longer requires trust.
        </h1>
        <p className="muted" style={{ marginTop: 16, fontSize: 17, lineHeight: 1.7 }}>
          Covenant is a CSD/USDC market where trades settle automatically. There is no custodian,
          no bridge, and no trusted third party of any kind.
        </p>
      </div>

      <div className="col" style={{ gap: 32 }}>

        {/* What it is */}
        <div className="card">
          <div className="faint" style={{ marginBottom: 12 }}>What it is</div>
          <p style={{ lineHeight: 1.8, color: "var(--muted)" }}>
            Covenant lets you trade CSD (Compute Substrate) for USDC on Ethereum.
            The settlement is fully trustless: the USDC release is conditional on a
            verifiable CSD payment, checked on-chain by a Compute Substrate light client
            deployed on Ethereum. If the CSD payment didn't happen, the USDC doesn't move.
            No attestation. No oracle. No custody.
          </p>
        </div>

        {/* How a trade works */}
        <div className="card">
          <div className="faint" style={{ marginBottom: 16 }}>How a trade works</div>
          <div className="col" style={{ gap: 14 }}>
            {[
              ["Seller posts an offer", "The seller creates a sell offer on the network — how much CSD they're selling and the USDC price. The offer is a public object on the AON network, visible to anyone."],
              ["Buyer authorizes the trade", "The buyer signs an EIP-712 authorization committing to: the exact USDC amount, the exact CSD amount, and their CSD receive address. This signature is published to the AON network and is irrevocable — it cryptographically binds the buyer to those specific terms."],
              ["Seller locks USDC", "When the seller is ready, they call the settlement contract directly from their wallet to lock the buyer's USDC. The contract verifies the buyer's signature, pulls the USDC (pre-approved by the buyer), and holds it in escrow for up to 20 minutes."],
              ["Seller sends CSD", "The seller sends the exact CSD amount to the buyer's address on the Compute Substrate network."],
              ["Proof submitted", "The CSD transaction is submitted as an SPV proof object to the AON network. The proof includes the raw transaction, the merkle path, and the block header."],
              ["Automatic settlement", "The executor verifies the proof on-chain: it checks that the transaction pays the correct amount to the correct address, that the transaction is in the block's merkle tree, and that the block meets the Compute Substrate network's proof-of-work target. If all checks pass, USDC is released to the seller."],
            ].map(([title, body], i) => (
              <div key={i} style={{ display: "flex", gap: 16 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                  background: "rgba(159,245,200,0.1)", border: "1px solid rgba(159,245,200,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, color: "var(--accent)", fontWeight: 600, marginTop: 1,
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
                mining a genuine Compute Substrate block — the same cost as honest mining.
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>100 USDC per trade limit</div>
              <div className="muted" style={{ fontSize: 14, lineHeight: 1.7 }}>
                The settlement contract enforces a hard cap of 100 USDC per trade.
                This limits exposure to 1-confirmation reorg risk on the Compute Substrate
                chain. The limit is in the contract itself — not the interface — so it
                cannot be bypassed. It will be raised as Compute Substrate hashrate grows
                and multi-confirmation settlement becomes practical.
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>No custody</div>
              <div className="muted" style={{ fontSize: 14, lineHeight: 1.7 }}>
                The settlement contract holds USDC only during the 20-minute lock window.
                If the CSD payment is not proven within that window, the USDC refunds to
                the buyer. At no point does any party — including Covenant — hold funds
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
                  AON — Authorization Object Network ↗
                </a>
              </div>
              <div className="muted" style={{ fontSize: 14, lineHeight: 1.7 }}>
                All coordination — sell offers, authorizations, proofs, receipts — lives as
                content-addressed objects on AON, a peer-to-peer network running across
                TCP/IP, WebSocket, LoRa, Bluetooth, and Reticulum simultaneously. There is
                no central database. Objects propagate to every connected node and are
                available forever by hash.
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>
                <a href="https://computesubstrate.org" target="_blank" rel="noreferrer">
                  Compute Substrate ↗
                </a>
              </div>
              <div className="muted" style={{ fontSize: 14, lineHeight: 1.7 }}>
                CSD is the native token of Compute Substrate, a proof-of-work settlement
                layer. The Compute Substrate light client deployed on Ethereum tracks the
                CSD header chain and verifies SPV proofs — the same mechanism Bitcoin uses
                to let lightweight clients verify payments without downloading the full chain.
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
