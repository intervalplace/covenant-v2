import Link from "next/link";

export default function Docs() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "56px 24px 80px" }}>

      <div style={{ marginBottom: 48 }}>
        <div className="label" style={{ marginBottom: 10 }}>Protocol Docs</div>
        <h1 style={{ fontFamily: "var(--serif)", fontWeight: "normal", fontSize: 36, lineHeight: 1.15 }}>
          Covenant Documentation
        </h1>
        <p className="muted" style={{ marginTop: 14, fontSize: 16 }}>
          Covenant separates permission from custody.
        </p>
      </div>

      <div className="card col" style={{ gap: 0 }}>

        <section style={{ padding: "24px 0", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Core Rule</h2>
          <p className="muted" style={{ lineHeight: 1.8, marginBottom: 10 }}>
            Execution is valid only when current authorization exists.
          </p>
          <p className="muted" style={{ lineHeight: 1.8 }}>
            Authorization is not a one-time setup step. It is a condition checked at
            settlement time. If the authorization has expired, been revoked, or exceeds
            its defined boundary, execution fails — regardless of what was agreed earlier.
          </p>
        </section>

        <section style={{ padding: "24px 0", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: 18, marginBottom: 16 }}>Roles</h2>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 5 }}>User</div>
            <p className="muted" style={{ lineHeight: 1.8 }}>
              Signs bounded authorizations. Assets stay in the user's wallet or in
              the settlement contract escrow — never in Covenant's custody.
              The user controls when to revoke.
            </p>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 5 }}>Seller</div>
            <p className="muted" style={{ lineHeight: 1.8 }}>
              In the CSD/USDC market, the seller controls the lock step.
              The seller calls the settlement contract directly from their wallet
              when they are ready to send CSD. This prevents the settlement window
              from expiring before the seller is prepared.
            </p>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 5 }}>Executor</div>
            <p className="muted" style={{ lineHeight: 1.8 }}>
              Submits the final settlement transaction on-chain. The executor pays
              gas but receives no custody over user assets and requires no standing
              authority. Any party with a valid proof can act as executor.
            </p>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 5 }}>Settlement Contract</div>
            <p className="muted" style={{ lineHeight: 1.8 }}>
              Verifies authorization signatures, validity windows, and payment proofs
              before releasing funds. Enforces all settlement conditions on-chain.
              Maximum 100 USDC per trade — enforced in the contract, not the interface.
            </p>
          </div>
        </section>

        <section style={{ padding: "24px 0", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>What runs underneath</h2>
          <p className="muted" style={{ lineHeight: 1.8, marginBottom: 10 }}>
            Covenant has no backend. All state — sell offers, buyer authorizations,
            payment proofs, receipts — lives on{" "}
            <a href="https://aon.network" target="_blank" rel="noreferrer">AON</a>,
            a peer-to-peer network of content-addressed objects. There is no Covenant
            database. If Covenant's interface disappeared tomorrow, every object would
            still exist on the network and any executor could settle outstanding trades
            directly against the contracts.
          </p>
          <p className="muted" style={{ lineHeight: 1.8 }}>
            Settlement is enforced by a{" "}
            <a href="https://computesubstrate.org" target="_blank" rel="noreferrer">Compute Substrate</a>{" "}
            light client deployed on Ethereum. The contract verifies SPV proofs of CSD
            payments — the same mechanism Bitcoin uses for lightweight payment verification.
          </p>
        </section>

        <section style={{ padding: "24px 0", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>CSD / USDC Flow</h2>
          <ol style={{ paddingLeft: 20, color: "var(--muted)", lineHeight: 2 }}>
            <li>Seller creates a CSD sell offer on the AON network.</li>
            <li>Buyer selects the offer and enters their CSD receive address.</li>
            <li>Buyer approves USDC and signs a bounded authorization — binding their address, exact amounts, and the specific offer.</li>
            <li>Seller sees the authorization and, when ready, locks USDC from their wallet.</li>
            <li>Seller sends CSD to the buyer's address on Compute Substrate.</li>
            <li>Seller submits the CSD transaction ID.</li>
            <li>The SPV proof is fetched and published to the AON network.</li>
            <li>The executor verifies the proof on-chain and releases USDC to the seller.</li>
          </ol>
        </section>

        <section style={{ padding: "24px 0", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Revocation</h2>
          <p className="muted" style={{ lineHeight: 1.8, marginBottom: 10 }}>
            Before settlement lock, the buyer can revoke authorization. Revocation
            is an object published to the AON network — executors check for it before
            acting. After revocation, the executor will not call the settlement contract.
          </p>
          <p className="muted" style={{ lineHeight: 1.8, marginBottom: 10 }}>
            During the lock window, USDC cannot be released to the buyer directly.
            The settlement contract enforces this: while locked, funds can only move
            via <code>settleCsdUsdc</code> (to the seller, on valid proof) or via
            <code> refundExpiredLock</code> (back to the buyer, after the window expires).
          </p>
          <p className="muted" style={{ lineHeight: 1.8 }}>
            If a buyer revokes on AON after USDC is locked, the seller can call the
            settlement contract directly with the CSD proof — bypassing the executor.
            The contract verifies the payment proof alone, independent of AON
            revocation state. The Covenant interface detects revocations while locked
            and shows the seller a direct settlement button.
          </p>
        </section>

        <section style={{ padding: "24px 0", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Security Boundaries</h2>
          <ul style={{ paddingLeft: 20, color: "var(--muted)", lineHeight: 2 }}>
            <li>No asset deposit into Covenant.</li>
            <li>No internal user balances.</li>
            <li>No standing execution authority.</li>
            <li>Authorization owner controls revocation.</li>
            <li>Settlement requires proof matching the signed authorization.</li>
            <li>Genesis hash, script hash, amount, and consumed-tx state are checked on-chain.</li>
            <li>Tampered transactions are rejected via merkle proof verification.</li>
            <li>Maximum 100 USDC per trade, enforced in the settlement contract.</li>
          </ul>
        </section>

        <section style={{ padding: "24px 0" }}>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Launch Status</h2>
          <p className="muted" style={{ lineHeight: 1.8 }}>
            Covenant is experimental software. The 100 USDC per trade limit reflects
            1-confirmation settlement on an early-stage proof-of-work chain. Settlement
            is trustless — the contract does not rely on Covenant or any operator — but
            trade sizes are bounded to match current network security assumptions.
            The limit will increase as Compute Substrate hashrate grows.
          </p>
        </section>

      </div>

      <div style={{ marginTop: 40, fontSize: 14, color: "var(--muted)" }}>
        <Link href="/">← Back to market</Link>
        {" · "}
        <a href="https://aon.network" target="_blank" rel="noreferrer">AON Network</a>
        {" · "}
        <a href="https://computesubstrate.org" target="_blank" rel="noreferrer">Compute Substrate</a>
      </div>

    </main>
  );
}
