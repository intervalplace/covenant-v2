import Link from "next/link";

export default function Docs() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 20px 64px" }}>

      <p className="muted" style={{ marginBottom: 10 }}>Protocol Docs</p>
      <h1 style={{ fontWeight: 600, lineHeight: 1.15, marginBottom: 14 }}>
        Covenant Documentation
      </h1>
      <p className="muted">Covenant separates permission from custody.</p>

      <hr style={{ margin: "34px 0", border: "none", borderTop: "1px solid #ddd" }} />

      <h2>Core Rule</h2>
      <p className="muted" style={{ marginTop: 12 }}>
        Execution is valid only when current authorization exists.
      </p>
      <p className="muted" style={{ marginTop: 12 }}>
        Authorization is not a one-time setup step. It is a condition checked at
        settlement time. If the authorization has expired, been revoked, or exceeds
        its defined boundary, execution fails, regardless of what was agreed earlier.
      </p>

      <hr style={{ margin: "34px 0", border: "none", borderTop: "1px solid #ddd" }} />

      <h2>Roles</h2>

      <h3 style={{ marginTop: 24 }}>User</h3>
      <p className="muted">
        Signs bounded authorizations. Assets stay in the user's wallet or in
        the settlement contract escrow. Assets are never in Covenant's custody.
        The user controls when to revoke.
      </p>

      <h3 style={{ marginTop: 24 }}>Seller</h3>
      <p className="muted">
        In the CSD/USDC market, the seller controls the lock step. The seller
        calls the settlement contract directly from their wallet when ready to
        send CSD. This prevents the settlement window from expiring before the
        seller is prepared.
      </p>

      <h3 style={{ marginTop: 24 }}>Executor</h3>
      <p className="muted">
        Observes the AON network for executable graphs and submits settlement
        transactions on-chain. The executor is permissionless: it does not have
        to be either party to the trade. Any third party can run executor software,
        find completed graphs, and call the settlement contract. The executor pays
        gas but holds no custody and requires no standing authority. Multiple
        executors can run simultaneously.
      </p>

      <h3 style={{ marginTop: 24 }}>Settlement Contract</h3>
      <p className="muted">
        Verifies authorization signatures, validity windows, and payment proofs
        before releasing funds. Enforces all settlement conditions on-chain.
        Maximum 100 USDC per trade, enforced in the contract rather than the interface.
      </p>

      <hr style={{ margin: "34px 0", border: "none", borderTop: "1px solid #ddd" }} />

      <h2>What runs underneath</h2>
      <p className="muted" style={{ marginTop: 12 }}>
        Covenant has no backend. All state (sell offers, buyer authorizations,
        payment proofs, receipts) lives on{" "}
        <a href="https://aon.network" target="_blank" rel="noreferrer">AON</a>,
        a peer-to-peer network of content-addressed objects. Settlement is
        permissionless: any third party observing the network can run executor
        software, find executable graphs, and settle them without asking anyone.
        There is no Covenant database. If the Covenant interface disappeared
        tomorrow, every object would still exist on the network and any executor
        could settle outstanding trades directly against the contracts.
      </p>
      <p className="muted" style={{ marginTop: 12 }}>
        Settlement is enforced by a{" "}
        <a href="https://computesubstrate.org" target="_blank" rel="noreferrer">Compute Substrate</a>{" "}
        light client deployed on Ethereum. The contract verifies SPV proofs of CSD
        payments using the same mechanism Bitcoin uses for lightweight payment verification.
      </p>

      <hr style={{ margin: "34px 0", border: "none", borderTop: "1px solid #ddd" }} />

      <h2>CSD / USDC Flow</h2>
      <ol style={{ paddingLeft: 22, color: "var(--muted)", lineHeight: 2.1, marginTop: 14 }}>
        <li>Seller creates a CSD sell offer on the AON network.</li>
        <li>Buyer selects the offer and enters their CSD receive address.</li>
        <li>Buyer approves USDC and signs a bounded authorization binding their address, exact amounts, and the specific offer.</li>
        <li>Seller sees the authorization and locks USDC from their wallet when ready.</li>
        <li>Seller sends CSD to the buyer's address on Compute Substrate.</li>
        <li>Seller submits the CSD transaction ID.</li>
        <li>The SPV proof is fetched and published as an object on AON.</li>
        <li>An executor finds the completed graph on AON and calls the settlement contract.</li>
        <li>The contract verifies the CSD payment proof independently and releases USDC to the seller.</li>
      </ol>

      <hr style={{ margin: "34px 0", border: "none", borderTop: "1px solid #ddd" }} />

      <h2>Revocation</h2>
      <p className="muted" style={{ marginTop: 12 }}>
        Before settlement lock, the buyer can revoke authorization. Revocation
        is an object published to the AON network. Executors check for it before
        acting. After revocation, the executor will not call the settlement contract.
      </p>
      <p className="muted" style={{ marginTop: 12 }}>
        During the lock window, USDC cannot be returned to the buyer directly.
        The settlement contract enforces this: while locked, funds can only move
        via <code style={{ fontFamily: "var(--mono)", fontSize: 14, background: "#f6f6f6", padding: "1px 5px", border: "1px solid #ddd" }}>settleCsdUsdc</code> (to the seller, on valid proof) or via{" "}
        <code style={{ fontFamily: "var(--mono)", fontSize: 14, background: "#f6f6f6", padding: "1px 5px", border: "1px solid #ddd" }}>refundExpiredLock</code> (back to the buyer, after the window expires).
      </p>
      <p className="muted" style={{ marginTop: 12 }}>
        If a buyer revokes on AON after USDC is locked, the seller can call the
        settlement contract directly with the CSD proof, bypassing the executor.
        The contract verifies the proof alone, independent of AON revocation state.
        The Covenant interface detects this and shows the seller a direct settlement button.
      </p>

      <hr style={{ margin: "34px 0", border: "none", borderTop: "1px solid #ddd" }} />

      <h2>Security Boundaries</h2>
      <ul style={{ paddingLeft: 22, color: "var(--muted)", lineHeight: 2.1, marginTop: 14 }}>
        <li>No asset deposit into Covenant.</li>
        <li>No internal user balances.</li>
        <li>No standing execution authority.</li>
        <li>Authorization owner controls revocation.</li>
        <li>Settlement requires proof matching the signed authorization.</li>
        <li>Genesis hash, script hash, amount, and consumed-tx state are checked on-chain.</li>
        <li>Tampered transactions are rejected via merkle proof verification.</li>
        <li>Maximum 100 USDC per trade, enforced in the settlement contract.</li>
      </ul>

      <hr style={{ margin: "34px 0", border: "none", borderTop: "1px solid #ddd" }} />

      <h2>Launch Status</h2>
      <p className="muted" style={{ marginTop: 12 }}>
        Covenant is experimental software. The 100 USDC per trade limit reflects
        1-confirmation settlement on an early-stage proof-of-work chain. Settlement
        is trustless — the contract does not rely on Covenant or any operator — but
        trade sizes are bounded to match current network security assumptions.
        The limit will increase as Compute Substrate hashrate grows.
      </p>

      <p className="muted" style={{ marginTop: 40, fontSize: 15 }}>
        <Link href="/">← Market</Link>
        {" · "}
        <Link href="/about">About</Link>
        {" · "}
        <a href="https://aon.network" target="_blank" rel="noreferrer">AON Network</a>
        {" · "}
        <a href="https://computesubstrate.org" target="_blank" rel="noreferrer">Compute Substrate</a>
      </p>

    </main>
  );
}
