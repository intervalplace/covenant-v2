import Link from "next/link";

const hr = <hr style={{ margin: "34px 0", border: "none", borderTop: "1px solid #ddd" }} />;
const code = (t: string) => (
  <code style={{ fontFamily: "var(--mono)", fontSize: 14, background: "#f6f6f6", padding: "1px 5px", border: "1px solid #ddd" }}>{t}</code>
);

export default function Docs() {
  return (
    <main className="prose" style={{ maxWidth: 720, margin: "0 auto", padding: "56px 24px 24px" }}>

      <p className="prose-kicker" style={{ marginBottom: 12 }}>Docs</p>
      <h1 style={{ fontWeight: 600, lineHeight: 1.15, marginBottom: 14 }}>Covenant Documentation</h1>
      <p className="muted">Covenant separates permission from custody.</p>
      <p className="muted" style={{ marginTop: 12 }}>
        Covenant is one example interface on AON. Everything below (the order
        format, the matching rules, the settlement contract) is open, so other
        interfaces can trade in the same book.
      </p>

      {hr}

      <h2>Core rule</h2>
      <p className="muted" style={{ marginTop: 12 }}>
        Execution is valid only when a current authorization covers it. The check
        happens at settlement time: if the authorization has expired, been used up,
        or doesn't cover the price, settlement fails regardless of what was matched.
      </p>

      {hr}

      <h2>Markets</h2>
      <p className="muted" style={{ marginTop: 12 }}>
        ETH/USDC on Ethereum mainnet, with more pairs to follow. Token addresses are
        fixed in the interface. On ETH/USDC, buy orders are paid out in native
        ETH: the contract unwraps WETH during settlement. Orders must be worth
        at least 25 USDC, so settlement gas stays a small part of each trade. Sellers need WETH,
        because a signed order can't pull native ETH from a wallet, so the
        interface wraps it as a step before signing. All markets run on the
        generic {code("aon:evm-spot")} namespace and settle through one
        {" "}{code("AonEvmSpotSettlement")} contract.
      </p>

      {hr}

      <h2 id="csd">CSD/USDC</h2>
      <p className="muted" style={{ marginTop: 12 }}>
        Compute Substrate (CSD) runs on its own blockchain, so it can&apos;t sit in an
        Ethereum wallet. You trade it with a market maker, settled by the
        {" "}{code("CsdUsdcSettlement")} contract on Ethereum, with objects in the
        {" "}{code("aon:csd-usdc")} namespace. Prices come from the market maker&apos;s
        pool: buying moves the price up, selling moves it down. Trades are 1–30 USDC for now.
      </p>

      <h3 id="csd-wallet" style={{ marginTop: 24 }}>Your CSD wallet</h3>
      <p className="muted" style={{ marginTop: 10 }}>
        The page gives you a CSD wallet of your own. Its keys are made from a
        signature by your Ethereum wallet and stay in your browser: Covenant and
        the market maker never have them and can&apos;t move your CSD. The same
        Ethereum wallet opens the same CSD wallet on any device, and
        &quot;Forget on this device&quot; removes it from the browser.
      </p>
      <p className="muted" style={{ marginTop: 10 }}>
        To sell CSD you hold elsewhere, send it to this wallet&apos;s address first.
        That isn&apos;t a deposit with an exchange: you&apos;re moving it to another
        wallet you control, and you can send it anywhere at any time with
        &quot;Send CSD&quot;. It lives in this wallet so the page can pay at exactly the
        right moment, which is what makes selling instant. Like any wallet kept in a
        browser, it&apos;s meant for trading amounts.
      </p>

      <h3 style={{ marginTop: 24 }}>Buying</h3>
      <p className="muted" style={{ marginTop: 10 }}>
        You sign twice, both free: the trade, and a USDC permit. No ETH needed. The
        market maker locks your USDC in the contract and sends the CSD as soon as
        the lock is on Ethereum. The contract pays the market maker only when it
        proves on Ethereum that it paid you (20 CSD blocks). If it doesn&apos;t, your
        USDC comes back: the market maker refunds it, or you can with the Refund
        button.
      </p>

      <h3 style={{ marginTop: 24 }}>Selling</h3>
      <p className="muted" style={{ marginTop: 10 }}>
        The market maker locks USDC for you in the contract first. The page checks
        that lock on Ethereum, then your CSD wallet pays, and the market maker
        releases the USDC straight away, in about half a minute. If it ever
        doesn&apos;t, the Claim button takes the USDC with a proof of your payment.
        Your CSD never moves before the USDC is locked for you.
      </p>

      {hr}

      <h2>Objects</h2>
      <ul style={{ paddingLeft: 22, color: "var(--muted)", lineHeight: 2.1, marginTop: 14 }}>
        <li><strong>Authorization</strong> — EIP-712 signed. Market, side, maximum base (sell) or quote (buy) exposure, executor fee budget, price band, validity window.</li>
        <li><strong>Order</strong> — EIP-712 signed. Limit price and size, bound to its authorization. One order can take liquidity, then rest and be filled as a maker.</li>
        <li><strong>Fill</strong> — a proposed match between a resting order and an incoming one, at the resting order's price. Anyone can publish one; the contract decides if it's valid.</li>
        <li><strong>Receipt</strong> — published by the executor after the settlement transaction confirms.</li>
        <li><strong>Revocation</strong> — signed by the order's owner. Cancels the order's authorization.</li>
      </ul>

      {hr}

      <h2>Matching</h2>
      <p className="muted" style={{ marginTop: 12 }}>
        Price-time priority. A new order walks the opposite side of the book from
        the best price, up to its limit, filling each resting order at that order's
        price. Each match becomes one fill object. The unfilled remainder of a
        limit order rests on the book as the same signed order. Market orders are
        signed only for the size that matched and expire after 15 minutes.
      </p>
      <p className="muted" style={{ marginTop: 12 }}>
        Matching happens in the trader's browser against the book as published on
        AON. If two traders race for the same liquidity, the contract's per-order
        fill accounting lets only one succeed. The other fill fails harmlessly and
        its size returns to the book after 10 minutes.
      </p>
      <p className="muted" style={{ marginTop: 12 }}>
        The interface hides orders whose owner no longer has the balance or
        approval to cover them, and blocks orders that would trade against your
        own resting orders.
      </p>

      {hr}

      <h2>Front-running protection</h2>
      <p className="muted" style={{ marginTop: 12 }}>
        Orders are public on AON before they settle. Without protection, someone
        could see a buy with a 3,015 limit, place their own sell at 3,015 and
        settle against it first, so the buyer pays 3,015 instead of the 3,005 in
        the book.
      </p>
      <p className="muted" style={{ marginTop: 12 }}>
        So an order that fills right away names, in its signed terms, the exact
        resting orders it matched and exactly how much it takes from each.
        Until that part has filled, the settlement contract only lets it trade
        with those orders, never more than the named amount from each and always
        at exactly its price, and nobody else can trade with your order at all.
        If a matched order has a little less left by the time your trade
        settles, you get what's left of it. Whatever of that part hasn't filled
        within five minutes (for example because someone took a matched order
        first) is simply void: it never opens up at your limit. Whatever else
        you ordered rests in the book as usual.
      </p>

      {hr}

      <h2>Market price and warnings</h2>
      <p className="muted" style={{ marginTop: 12 }}>
        The market price shown next to each book comes from Chainlink's price
        feeds, read directly from Ethereum through the Chainlink Feed Registry
        and converted from USD to USDC with Chainlink's USDC/USD feed. It is a
        reference only; Covenant trades at whatever prices traders sign.
      </p>
      <p className="muted" style={{ marginTop: 12 }}>
        The order form compares your order to it. Anything that fills now is
        judged by its average price, and anything left waiting in the book by
        its limit price, since anyone can take it at that price. From 2% worse
        than market you see a note; from 10% you must confirm before signing.
        If a feed is missing or more than 26 hours old, there is no reference
        and no warning.
      </p>

      {hr}

      <h2>Connections</h2>
      <p className="muted" style={{ marginTop: 12 }}>
        Once your wallet is connected to Ethereum, Covenant reads the chain
        through your wallet's own connection, so it needs no RPC of its own.
        The order book comes from AON nodes, tried in order. You can set your own
        RPC and AON node under Network live → Connections.
      </p>

      {hr}

      <h2>Roles</h2>
      <h3 style={{ marginTop: 24 }}>Trader</h3>
      <p className="muted">Signs bounded orders. Tokens stay in the trader's wallet until settlement.</p>
      <h3 style={{ marginTop: 24 }}>Executor</h3>
      <p className="muted">
        Watches AON for executable fills and submits them to the settlement
        contract. Permissionless: anyone can run one. The buyer can pay the
        executor a small fee, a percentage of each fill. The contract caps it in
        proportion to the fill's size, so a tiny fill can only carry a tiny fee.
      </p>
      <p className="muted" style={{ marginTop: 12 }}>
        No executor is required. Any trader can settle their own matched trade
        straight away with "Settle now": the interface builds the same
        transaction an executor would and sends it from your wallet. You pay the
        gas, and any executor fee in the trade goes to you.
      </p>
      <h3 style={{ marginTop: 24 }}>Settlement contract</h3>
      <p className="muted">
        Verifies both authorizations and both orders, checks prices, exposure
        limits and cumulative fills, then transfers base and quote between the two
        wallets in one transaction.
      </p>

      {hr}

      <h2>Cancellation</h2>
      <p className="muted" style={{ marginTop: 12 }}>
        Cancel publishes a revocation, signed by you, to AON. It's free, and
        executors and the interface stop matching the order immediately. The
        contract itself doesn't read AON, so until expiry someone could still
        settle the signed order by calling the contract directly, though only at
        your limit price or better.
      </p>
      <p className="muted" style={{ marginTop: 12 }}>
        Cancel on-chain does the same and also calls {code("revokeAuthorization")}
        {" "}on the settlement contract, which makes the order unsettleable by
        anyone. It costs gas.
      </p>

      {hr}

      <h2>Security boundaries</h2>
      <ul style={{ paddingLeft: 22, color: "var(--muted)", lineHeight: 2.1, marginTop: 14 }}>
        <li>No deposits and no internal balances.</li>
        <li>Every fill must satisfy both parties' signed price limits.</li>
        <li>Cumulative fills per order and exposure per authorization are enforced on-chain.</li>
        <li>Each fill settles at most once; replays revert. If less is left than a fill asks for, it settles what's left (at the same price, never more than either side signed).</li>
        <li>Signatures use EIP-712 with low-s enforcement.</li>
        <li>Settlement status comes from the contract, not from receipts, so a forged receipt can't mark a trade as settled.</li>
      </ul>

      {hr}

      <h2>Launch status</h2>
      <p className="muted" style={{ marginTop: 12 }}>
        Covenant is experimental software and the settlement contract has not
        been audited. Trade sizes you're comfortable losing.
      </p>

      <p className="prose-kicker" style={{ marginTop: 40 }}>
        <Link href="/">← Back to trading</Link><Link href="/about" style={{ marginLeft: 18 }}>How it works</Link>
        <a href="https://aon.network" target="_blank" rel="noreferrer" style={{ marginLeft: 18 }}>AON Network</a>
      </p>
    </main>
  );
}
