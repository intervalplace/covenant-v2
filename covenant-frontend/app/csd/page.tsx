"use client";
// CSD/USDC: trade Compute Substrate for USDC with a market maker, settled by
// CsdUsdcSettlement on Ethereum. Both directions finish in about one Ethereum
// block. Buying, the user's USDC is locked by permit (no ETH needed) and only
// reaches the market maker once it proves the CSD payment on Ethereum. Selling,
// the market maker locks USDC for the user first, the page checks the lock on
// Ethereum, and only then does the in-site CSD wallet pay.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useConnect, usePublicClient, useSignTypedData, useWriteContract } from "wagmi";
import { injected } from "@wagmi/core";
import { formatUnits, hashTypedData, keccak256, parseUnits, toHex, type Address, type Hex } from "viem";
import { CHAIN_ID } from "@/config";
import { MarketTabs } from "@/market-tabs";
import {
  CSD_ENABLED, CSD_MM_URL, CSD_SETTLEMENT, CSD_USDC, CSD_GENESIS, CSD_BUY_CONFIRMATIONS, CSD_EXPLORER, CSD_NODE_URL, CSD_TARGET_REF, csdSettleAbi,
  CSD_AUTH_TYPES, PERMIT_TYPES, csdDomain, csdSettlementAbi, usdcPermitAbi, mmGet, mmPost, type CsdMarket,
} from "@/csd/config";
import { addr20ToBytes32, csdAddressProof, txToNodeJson, txFromNodeJson, bitsToTarget, suggestedMaxTarget, csdNode, type Hex as CHex } from "@/csd/csd-wallet";
import { quoteBuy, quoteSell, midPrice, type Pool } from "@/csd/pool";
import { useCsdWallet } from "@/csd/useCsdWallet";

type Side = "buy" | "sell";
type MyTrade = { authHash: Hex; side: Side; csdAmount: string; usdcAmount: string; at: number; lockTx?: Hex; csdTxid?: Hex; releaseTx?: Hex;
  status: "pending" | "done" | "failed"; csdAddress?: Hex; authorization?: any; signature?: Hex; csdTx?: any };
type Banner = { kind: "info" | "ok" | "danger"; text: string; links?: { href: string; label: string }[] } | null;

const etherscanTx = (tx: string) => (CHAIN_ID === 1 ? `https://etherscan.io/tx/${tx}` : "#");
const csdTxLink = (txid: string) => (CSD_EXPLORER ? `${CSD_EXPLORER.replace(/\/$/, "")}/tx/${txid}` : "");
const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
function fmtUnits(x: bigint, decimals: number, dp: number) {
  const neg = x < 0n; const v = neg ? -x : x;
  const scale = 10n ** BigInt(decimals - dp), r = (v + scale / 2n) / scale;
  const s = r.toString().padStart(dp + 1, "0"), int = s.slice(0, s.length - dp), frac = s.slice(s.length - dp);
  return (neg ? "-" : "") + group(int) + (dp ? "." + frac : "");
}
const fmtCsd = (x: bigint, dp = 4) => fmtUnits(x, 8, dp).replace(/\.?0+$/, "") || "0";
const fmtUsdc = (x: bigint) => fmtUnits(x, 6, 2);
const fmtPx = (x: bigint) => fmtUnits(x, 6, 4); // USDC per CSD
const parseCsd = (s: string) => { try { return s.trim() ? parseUnits(s.trim(), 8) : 0n; } catch { return -1n; } };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const errText = (e: any) => {
  const m = String(e?.shortMessage ?? e?.message ?? e);
  if (/User rejected|denied/i.test(m)) return "You cancelled in your wallet. Nothing was traded.";
  if (m === "SELLS_PAUSED") return "Selling is paused for a little while. Try again later.";
  if (m === "FINISH_YOUR_OTHER_SALE" || m === "TOO_MANY_UNPAID_SALES") return "Finish or wait out your other sale first.";
  if (m === "TOO_LATE_TO_PAY") return "That offer expired before your CSD was sent. Nothing was sent; try again.";
  if (m.startsWith("PRICE_MOVED")) return "The price moved while you were signing. Check the new price and try again.";
  if (m === "BUSY_TRY_AGAIN_SHORTLY") return "The market maker is busy with other trades. Try again in a minute.";
  if (m.startsWith("NOT_ENOUGH_")) return "The market maker can't fill that size right now. Try a smaller amount.";
  if (m.startsWith("CSD_MAX_TARGET") || m.startsWith("VALID_BEFORE") || m === "FEE_TOO_LOW") return "The market maker's terms just changed. Reload the page and try again.";
  if (m.startsWith("LOCK_REJECTED")) return "Ethereum rejected the USDC lock, so nothing was traded. Check your USDC balance and try again.";
  return m;
};

// CSD's current difficulty target from a node the site trusts (not the market
// maker), or null when the build has none
const independentNode = CSD_NODE_URL ? csdNode(CSD_NODE_URL) : null;
async function trustedCsdTarget(): Promise<bigint | null> {
  if (!independentNode) return null;
  const tip = await independentNode.tip();
  return bitsToTarget(Number((await independentNode.headerAt(tip.height)).bits));
}
// The easiest difficulty a buy may sign for: 3/4 of the real one (live), or half
// of the build's reference. Easier than that and fake CSD blocks get cheap.
async function maxBuyTarget(): Promise<bigint> {
  const live = await trustedCsdTarget().catch(() => null);
  if (live !== null) { const s = live * 4n / 3n; return s > live ? s : live; }
  return CSD_TARGET_REF * 2n;
}
// The hardest difficulty a market maker's lock may demand for your sale, so that
// you could still prove your payment yourself: the real one (live), or twice the reference.
async function minSellTarget(): Promise<bigint> {
  const live = await trustedCsdTarget().catch(() => null);
  return live !== null ? live : CSD_TARGET_REF / 2n;
}
const work = (target: bigint) => (1n << 256n) / (target + 1n);

export default function CsdMarketPage() {
  const { address, isConnected, chainId } = useAccount();
  const { connect } = useConnect();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const csd = useCsdWallet(address);
  const [m, setM] = useState<CsdMarket | null>(null);
  const [mErr, setMErr] = useState("");
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [usdcBal, setUsdcBal] = useState<bigint | null>(null);
  const [remember, setRemember] = useState(true);
  const [sendTo, setSendTo] = useState(""); const [sendAmt, setSendAmt] = useState("");
  const [copied, setCopied] = useState(false);
  const tradesKey = address ? `covenant.csd.trades.${address.toLowerCase()}` : "";
  const [mine, setMine] = useState<MyTrade[]>([]);

  // market data
  useEffect(() => {
    if (!CSD_ENABLED) return;
    let live = true;
    const load = () => mmGet<CsdMarket>("/market").then(x => { if (live) { setM(x); setMErr(""); } }).catch(e => live && setMErr(e.message));
    load(); const id = setInterval(load, 5000);
    return () => { live = false; clearInterval(id); };
  }, []);

  // your trades (kept in this browser)
  useEffect(() => { try { setMine(tradesKey ? JSON.parse(localStorage.getItem(tradesKey) ?? "[]") : []); } catch { setMine([]); } }, [tradesKey]);
  const saveTrade = useCallback((t: MyTrade) => setMine(prev => {
    const next = [t, ...prev.filter(x => x.authHash !== t.authHash)].slice(0, 100);
    try { localStorage.setItem(tradesKey, JSON.stringify(next)); } catch {}
    return next;
  }), [tradesKey]);

  const readUsdc = useCallback(async () => {
    if (!address || !publicClient) return;
    try { setUsdcBal(await publicClient.readContract({ address: CSD_USDC, abi: usdcPermitAbi, functionName: "balanceOf", args: [address] }) as bigint); } catch {}
  }, [address, publicClient]);
  useEffect(() => { readUsdc(); const id = setInterval(readUsdc, 15000); return () => clearInterval(id); }, [readUsdc]);

  // pending sells: the market maker releases after a CSD block
  useEffect(() => {
    const pending = mine.filter(t => t.side === "sell" && t.status === "pending" && t.csdTxid);
    if (!pending.length) return;
    const id = setInterval(async () => {
      for (const t of pending) {
        try { const r = await mmGet(`/trade/${t.authHash}`); if (r.releaseTx) { saveTrade({ ...t, releaseTx: r.releaseTx, status: "done" }); readUsdc(); } } catch {}
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [mine, saveTrade, readUsdc]);

  // pending buys: CSD is on its way until a coin shows up at the trade's address
  const incoming = mine.filter(t => t.side === "buy" && t.status === "pending").reduce((s, t) => s + BigInt(t.csdAmount), 0n);
  useEffect(() => {
    for (const t of mine) if (t.side === "buy" && t.status === "pending" && t.csdAddress && csd.coins.some(c => c.key.addr20 === t.csdAddress)) saveTrade({ ...t, status: "done" });
  }, [csd.coins, mine, saveTrade]);

  const pool: Pool | null = m ? { usdc: BigInt(m.pool.usdc), csd: BigInt(m.pool.csd), spreadBps: BigInt(m.spreadBps) } : null;
  const fee = m ? BigInt(m.feeUsdc) : 0n;
  const csdAmt = parseCsd(amount);
  const preview = useMemo(() => {
    if (!pool || csdAmt <= 0n) return null;
    try {
      if (side === "buy") { const usdc = quoteBuy(pool, csdAmt); return { usdc, total: usdc + fee }; }
      const out = quoteSell(pool, csdAmt); return { usdc: out - fee, total: out - fee };
    } catch { return null; }
  }, [pool?.usdc, pool?.csd, csdAmt, side, fee]);

  const problem = (() => {
    if (!m || csdAmt === 0n) return "";
    if (csdAmt < 0n) return "Enter an amount like 25 or 12.5.";
    if (!preview) return "That's more than the market maker can trade at once.";
    const total = side === "buy" ? preview.total : preview.usdc + fee;
    if (total > BigInt(m.limits.maxTradeUsdc)) return `Trades are limited to ${fmtUsdc(BigInt(m.limits.maxTradeUsdc))} USDC each for now.`;
    if (preview.usdc < BigInt(m.limits.minTradeUsdc)) return `The smallest trade is ${fmtUsdc(BigInt(m.limits.minTradeUsdc))} USDC.`;
    if (side === "buy" && usdcBal !== null && preview.total > usdcBal) return `You have ${fmtUsdc(usdcBal)} USDC.`;
    if (side === "sell" && csd.ready && csd.loaded && csdAmt + 10_000n > csd.balance) return `Your CSD wallet has ${fmtCsd(csd.balance)} CSD ready to spend.`;
    return "";
  })();

  async function buy() {
    if (!address || !publicClient || !m || !preview) return;
    setBanner(null);
    try {
      let w = csd.wallet;
      if (!w) { setBusy("Setting up your CSD wallet…"); w = await csd.setup(remember); }
      setBusy("Sign the trade in your wallet (1 of 2)…");
      const fresh = await mmGet<CsdMarket>("/market"); setM(fresh);
      const p = { usdc: BigInt(fresh.pool.usdc), csd: BigInt(fresh.pool.csd), spreadBps: BigInt(fresh.spreadBps) };
      const usdcAmount = quoteBuy(p, csdAmt), feeAmt = BigInt(fresh.feeUsdc);
      if (usdcAmount + feeAmt > preview.total * 1005n / 1000n) throw new Error(`PRICE_MOVED`);
      // Never sign an easier difficulty than the site's own bound, whatever the market maker suggests
      const cap = await maxBuyTarget(), suggested = BigInt(fresh.csd.suggestedMaxTarget);
      const csdMaxTarget = suggested < cap ? suggested : cap;
      const key = csd.freshKey(w);
      const t = Math.floor(Date.now() / 1000);
      const auth = { buyer: address, sellerUsdcRecipient: fresh.marketMaker, sellerCsdScriptHash: addr20ToBytes32(key.addr20) as Hex, csdGenesisHash: CSD_GENESIS,
        tradeIntentHash: keccak256(toHex("covenant.market CSD/USDC")), csdAmount: csdAmt, usdc: CSD_USDC, usdcAmount, minConfirmations: CSD_BUY_CONFIRMATIONS,
        csdMaxTarget, executorFeeAmount: feeAmt, validAfter: BigInt(t - 120), validBefore: BigInt(t + 3 * 3600),
        nonce: toHex(crypto.getRandomValues(new Uint8Array(32))) };
      const signature = await signTypedDataAsync({ domain: csdDomain(), types: CSD_AUTH_TYPES, primaryType: "CsdUsdcAuthorization", message: auth });
      const authHash = hashTypedData({ domain: csdDomain(), types: CSD_AUTH_TYPES, primaryType: "CsdUsdcAuthorization", message: auth });
      setBusy("Approve the USDC with a free signature (2 of 2)…");
      const [name, version, nonce] = await Promise.all([
        publicClient.readContract({ address: CSD_USDC, abi: usdcPermitAbi, functionName: "name" }),
        publicClient.readContract({ address: CSD_USDC, abi: usdcPermitAbi, functionName: "version" }),
        publicClient.readContract({ address: CSD_USDC, abi: usdcPermitAbi, functionName: "nonces", args: [address] }),
      ]) as [string, string, bigint];
      const deadline = BigInt(t + 300); // short: if this trade doesn't happen now, the permit can't be used later
      const ps = await signTypedDataAsync({ domain: { name, version, chainId: CHAIN_ID, verifyingContract: CSD_USDC }, types: PERMIT_TYPES, primaryType: "Permit",
        message: { owner: address, spender: CSD_SETTLEMENT, value: usdcAmount + feeAmt, nonce, deadline } });
      setBusy("Locking your USDC and sending the CSD…");
      const r = await mmPost("/buy", { authorization: auth, signature, addressProof: csdAddressProof(key, authHash as CHex),
        permit: { deadline, r: ps.slice(0, 66), s: "0x" + ps.slice(66, 130), v: parseInt(ps.slice(130, 132), 16) } });
      saveTrade({ authHash, side: "buy", csdAmount: String(csdAmt), usdcAmount: String(usdcAmount + feeAmt), at: Date.now(), lockTx: r.lockTx, status: "pending", csdAddress: key.addr20 as Hex });
      setAmount("");
      setBanner({ kind: "ok", text: `Bought ${fmtCsd(csdAmt)} CSD for ${fmtUsdc(usdcAmount + feeAmt)} USDC. The CSD is sent as soon as your USDC lock is on Ethereum (a few seconds), and can be spent after its first CSD block (about 2 minutes). Your USDC is held by the contract until the market maker proves the payment, or comes back to you.`,
        links: [{ href: etherscanTx(r.lockTx), label: "USDC lock" }] });
      setTimeout(readUsdc, 15000);
    } catch (e) { setBanner({ kind: "danger", text: errText(e) }); }
    finally { setBusy(null); }
  }

  async function sell() {
    if (!address || !publicClient || !m || !preview) return;
    setBanner(null);
    try {
      if (!csd.wallet) { setBusy("Setting up your CSD wallet…"); await csd.setup(remember); setBusy(null); return; }
      setBusy("Asking the market maker to lock your USDC…");
      const minOut = preview.usdc * 995n / 1000n;
      const o = await mmPost("/sell/open", { csdAmount: csdAmt, usdcRecipient: address, minUsdcOut: minOut });
      // Check everything ourselves before any CSD leaves the wallet
      const a = o.authorization ?? {};
      const auth = { ...a, csdAmount: BigInt(a.csdAmount), usdcAmount: BigInt(a.usdcAmount), minConfirmations: BigInt(a.minConfirmations), csdMaxTarget: BigInt(a.csdMaxTarget),
        executorFeeAmount: BigInt(a.executorFeeAmount), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) };
      const authHash = hashTypedData({ domain: csdDomain(), types: CSD_AUTH_TYPES, primaryType: "CsdUsdcAuthorization", message: auth });
      // ...including that you could prove the payment yourself if the market maker never released:
      // a difficulty real blocks meet, and enough time on the lock for its confirmations
      const ok = authHash === o.authHash && auth.sellerUsdcRecipient?.toLowerCase() === address.toLowerCase() && auth.csdAmount === csdAmt
        && auth.usdcAmount >= minOut && auth.usdc?.toLowerCase() === CSD_USDC.toLowerCase() && auth.csdGenesisHash?.toLowerCase() === CSD_GENESIS.toLowerCase()
        && auth.minConfirmations <= 20n && auth.csdMaxTarget >= await minSellTarget()
        && auth.sellerCsdScriptHash?.toLowerCase() === addr20ToBytes32(o.csdAddress).toLowerCase();
      if (!ok) throw new Error("The market maker's offer didn't match what you asked for. Nothing was sent.");
      saveTrade({ authHash, side: "sell", csdAmount: String(csdAmt), usdcAmount: String(auth.usdcAmount), at: Date.now(), lockTx: o.lockTx, status: "pending", authorization: a, signature: o.signature });
      setBusy("Waiting for the USDC lock on Ethereum…");
      for (let i = 0; ; i++) {
        const [locked, until] = await Promise.all([
          publicClient.readContract({ address: CSD_SETTLEMENT, abi: csdSettlementAbi, functionName: "usdcLocked", args: [authHash] }),
          publicClient.readContract({ address: CSD_SETTLEMENT, abi: csdSettlementAbi, functionName: "lockedUntil", args: [authHash] }),
        ]) as [boolean, bigint];
        if (locked && Number(until) - Date.now() / 1000 > Number(auth.minConfirmations) * 240 + 300) break;
        if (i > 60) throw new Error("The USDC lock didn't appear on Ethereum. Nothing was sent; you can try again.");
        await sleep(2000);
      }
      setBusy("Sending your CSD…");
      const p = csd.pay([{ value: csdAmt, addr20: o.csdAddress }]);
      const r = await mmPost("/sell/pay", { authHash, tx: txToNodeJson(p.tx) });
      independentNode?.submit(p.tx).catch(() => {}); // also broadcast it ourselves, not only through the market maker
      csd.spentLocally(new Set(p.spent.map(s => s.txid)));
      saveTrade({ authHash, side: "sell", csdAmount: String(csdAmt), usdcAmount: String(auth.usdcAmount), at: Date.now(), lockTx: o.lockTx, csdTxid: p.txid, releaseTx: r.releaseTx, status: r.releaseTx ? "done" : "pending", authorization: a, signature: o.signature, csdTx: txToNodeJson(p.tx) });
      setAmount("");
      if (r.releaseTx) {
        setBusy("Releasing your USDC…");
        await publicClient.waitForTransactionReceipt({ hash: r.releaseTx }).catch(() => {});
        setBanner({ kind: "ok", text: `Sold ${fmtCsd(csdAmt)} CSD for ${fmtUsdc(auth.usdcAmount)} USDC. It's in your wallet.`, links: [{ href: etherscanTx(r.releaseTx), label: "Transaction" }] });
      } else {
        setBanner({ kind: "info", text: `Sold ${fmtCsd(csdAmt)} CSD for ${fmtUsdc(auth.usdcAmount)} USDC. The market maker is releasing it after the next CSD block, in about 2 minutes. It's locked for you on Ethereum in the meantime.` });
      }
      readUsdc(); setTimeout(csd.refresh, 3000);
    } catch (e) { setBanner({ kind: "danger", text: errText(e) }); }
    finally { setBusy(null); }
  }

  // If the market maker never releases a sale you paid for, claim it yourself
  // with a proof of your CSD payment (you pay the Ethereum gas)
  async function claim(t: MyTrade) {
    if (!t.authorization || !t.signature || !t.csdTxid || !publicClient) return;
    setBanner(null); setBusy("Building the proof of your CSD payment…");
    try {
      const a = t.authorization, conf = Number(a.minConfirmations);
      const base = CSD_NODE_URL || `${CSD_MM_URL}/api/csd`;
      if (t.csdTx) { const n = csdNode(base); await n.submit(txFromNodeJson(t.csdTx)).catch(() => {}); }
      const proof = await (await fetch(`${base}/proof/tx/${t.csdTxid}`)).json();
      if (!proof?.ok) throw new Error("Your CSD payment isn't in a block yet. Try again in a few minutes.");
      const need = BigInt(conf) * work(BigInt(a.csdMaxTarget)); let have = work(bitsToTarget(Number(proof.header.bits)));
      const chain: any[] = []; const n = csdNode(base);
      for (let h = Number(proof.height) + 1; have < need && chain.length < 120; h++) {
        const hd = await n.headerAt(h); if (!hd?.bits) throw new Error(`Not enough CSD blocks yet: the proof needs about ${conf} after your payment. Try again later.`);
        chain.push(hd); have += work(bitsToTarget(Number(hd.bits)));
      }
      const hdr = (h: any) => ({ version: Number(h.version), prev: h.prev, merkle: h.merkle, time: BigInt(h.time), bits: Number(h.bits), nonce: Number(h.nonce) });
      const auth = { ...a, csdAmount: BigInt(a.csdAmount), usdcAmount: BigInt(a.usdcAmount), minConfirmations: BigInt(a.minConfirmations), csdMaxTarget: BigInt(a.csdMaxTarget),
        executorFeeAmount: BigInt(a.executorFeeAmount), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) };
      setBusy("Confirm the claim in your wallet…");
      const tx = await writeContractAsync({ address: CSD_SETTLEMENT, abi: csdSettleAbi, functionName: "settleCsdUsdc", args: [auth, t.signature, {
        txRaw: proof.tx_raw, merkleBranch: (proof.merkle_branch ?? []).map((s: any) => ({ hash: s.hash, isLeft: s.position === "left" })),
        header: hdr(proof.header), confirmationChain: chain.map(hdr) }] });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      saveTrade({ ...t, releaseTx: tx, status: "done" }); readUsdc();
      setBanner({ kind: "ok", text: `Claimed ${fmtUsdc(BigInt(t.usdcAmount))} USDC with a proof of your CSD payment.`, links: [{ href: etherscanTx(tx), label: "Transaction" }] });
    } catch (e) { setBanner({ kind: "danger", text: errText(e) }); }
    finally { setBusy(null); }
  }

  async function sendCsd() {
    const to = sendTo.trim().replace(/^0x/, "").toLowerCase(), v = parseCsd(sendAmt);
    if (!/^[0-9a-f]{40}$/.test(to)) { setBanner({ kind: "danger", text: "A CSD address is 40 hexadecimal characters." }); return; }
    if (v <= 0n) { setBanner({ kind: "danger", text: "Enter an amount to send." }); return; }
    setBusy("Sending CSD…");
    try {
      const txid = await csd.send(("0x" + to) as Hex, v);
      setSendTo(""); setSendAmt("");
      setBanner({ kind: "ok", text: `Sent ${fmtCsd(v)} CSD.`, links: csdTxLink(txid) ? [{ href: csdTxLink(txid), label: "CSD transaction" }] : [] });
    } catch (e) { setBanner({ kind: "danger", text: errText(e) }); }
    finally { setBusy(null); }
  }

  const asks = m ? m.asks.map(x => ({ price: BigInt(x.price), csd: BigInt(x.csd) })) : [];
  const bids = m ? m.bids.map(x => ({ price: BigInt(x.price), csd: BigInt(x.csd) })) : [];
  const cum = (rows: { csd: bigint }[], i: number) => rows.slice(0, i + 1).reduce((s, r) => s + r.csd, 0n);
  const maxCum = [cum(asks, asks.length - 1), cum(bids, bids.length - 1)].reduce((a, b) => (a > b ? a : b), 1n);
  const row = (l: { price: bigint; csd: bigint }, i: number, s: Side, rows: typeof asks) => {
    const c = cum(rows, i);
    return (
      <button key={`${s}-${i}`} className="book-row" data-side={s === "buy" ? "buy" : "sell"} style={{ ["--depth" as any]: `${Number((c * 1000n) / maxCum) / 10}%` }}
        onClick={() => { setSide(s === "sell" ? "buy" : "sell"); setAmount(formatUnits(c, 8)); }}
        title={s === "sell" ? `Buy ${fmtCsd(c)} CSD` : `Sell ${fmtCsd(c)} CSD`}>
        <span className={s}>{fmtPx(l.price)}</span>
        <span>{fmtCsd(l.csd, 2)}</span>
        <span className="muted">{fmtUsdc((l.price * l.csd) / 100_000_000n)}</span>
      </button>
    );
  };

  const wrongChain = isConnected && chainId !== CHAIN_ID;
  const mid = pool ? midPrice(pool) : null;

  return (
    <main style={{ maxWidth: 1240, margin: "0 auto", padding: "0 24px" }}>
      <section className="hero" style={{ gridTemplateColumns: "1fr", paddingBottom: 12 }}>
        <div>
          <h1 className="hero-title">CSD for USDC, as fast as a swap.</h1>
          <p className="hero-sub">
            Buy or sell Compute Substrate with USDC on Ethereum. No ETH needed, nothing to wait for.
            Your USDC is held by the contract until the CSD is proven, or it comes back to you.
          </p>
        </div>
      </section>

      {!CSD_ENABLED && (
        <div className="banner banner-warn"><strong className="warn">Coming soon</strong><span className="muted">The CSD/USDC market isn't live yet.</span></div>
      )}
      {mErr && <div className="banner banner-danger"><strong className="danger">Can't reach the market maker</strong><span className="muted">Prices may be out of date. Retrying automatically.</span></div>}
      {banner && (
        <div className={`banner banner-${banner.kind === "danger" ? "danger" : banner.kind}`} role="status">
          <span>{banner.text}{banner.links?.map(l => <span key={l.href}>{" "}<a href={l.href} target="_blank" rel="noreferrer">{l.label}</a></span>)}</span>
          <button className="link-btn" style={{ marginLeft: "auto" }} onClick={() => setBanner(null)}>Dismiss</button>
        </div>
      )}

      <div className="market-bar">
        <MarketTabs active="CSD-USDC" />
        <div className="market-stats">
          <div title="The market maker's price: the USDC it holds divided by the CSD it holds"><div className="stat-label">Price</div><div className="stat">{mid !== null ? fmtPx(mid) : "—"}</div></div>
          <div><div className="stat-label">Best bid</div><div className="stat buy">{m ? fmtPx(BigInt(m.bestBid)) : "—"}</div></div>
          <div><div className="stat-label">Best ask</div><div className="stat sell">{m ? fmtPx(BigInt(m.bestAsk)) : "—"}</div></div>
          <div title="Buying: the CSD is sent at once. Selling: two Ethereum blocks."><div className="stat-label">Trade time</div><div className="stat">&lt; 30 s</div></div>
        </div>
      </div>
      <p className="market-note">
        Prices come from a market maker&apos;s pool: buying moves the price up, selling moves it down. Trades are 1–30 USDC for now.
      </p>

      <div className="exchange-grid">
        <section className="card" aria-label="Order book" style={{ padding: "18px 14px" }}>
          <div className="row-between" style={{ margin: "0 6px 12px" }}>
            <h2 className="panel-title" style={{ fontFamily: "var(--sans)" }}>Order book</h2>
            <span className="faint">Tap a price to trade it</span>
          </div>
          <div className="book-head"><span>Price (USDC)</span><span>Size (CSD)</span><span>Total (USDC)</span></div>
          {!m ? <div className="book-empty">{mErr ? "Unavailable right now." : "Loading the book…"}</div> : (
            <>
              <div className="book-side book-asks">{[...asks].map((l, i) => ({ l, i })).reverse().map(({ l, i }) => row(l, i, "sell", asks))}</div>
              <div className="book-spread">
                <span className="last">{mid !== null ? fmtPx(mid) : "—"}</span>
                <span className="faint">Spread {Number(m.spreadBps) / 100}% each side</span>
              </div>
              <div className="book-side">{bids.map((l, i) => row(l, i, "buy", bids))}</div>
            </>
          )}
        </section>

        <section className="card order-card grid" aria-label="Trade" style={{ alignContent: "start", gap: 16 }}>
          <div className="seg-side" role="radiogroup" aria-label="Buy or sell">
            <button role="radio" aria-checked={side === "buy"} className={side === "buy" ? "side-buy on" : "side-buy"} onClick={() => setSide("buy")}>Buy CSD</button>
            <button role="radio" aria-checked={side === "sell"} className={side === "sell" ? "side-sell on" : "side-sell"} onClick={() => setSide("sell")}>Sell CSD</button>
          </div>
          <div>
            <label htmlFor="csd-amount">Amount</label>
            <div className="field-unit">
              <input id="csd-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={e => setAmount(e.target.value.replace(",", "."))} placeholder="0.00" />
              <span className="unit">CSD</span>
            </div>
            {side === "sell" && csd.ready && csd.balance > 0n && (
              <div className="pct-row" aria-label="Use part of your CSD">
                {[25n, 50n, 75n, 100n].map(p => (
                  <button key={String(p)} className="pct" onClick={() => setAmount(formatUnits(p === 100n ? csd.balance - 10_000n : (csd.balance * p) / 100n, 8))}>{p === 100n ? "Max" : `${p}%`}</button>
                ))}
              </div>
            )}
          </div>
          <div className="summary">
            <div className="row-between">
              <span className="muted">{side === "buy" ? "You pay" : "You receive"}</span>
              <span>{preview ? `${fmtUsdc(side === "buy" ? preview.total : preview.usdc)} USDC` : "—"}</span>
            </div>
            {preview && <div className="faint">{fmtPx((preview.usdc + (side === "buy" ? 0n : fee)) * 100_000_000n / csdAmt)} USDC per CSD, {side === "buy" ? "plus" : "after"} a {fmtUsdc(fee)} USDC fee that covers the Ethereum gas</div>}
            <div className="row-between">
              <span className="muted">Available</span>
              <span>{!isConnected ? "Connect a wallet to see" : side === "buy" ? (usdcBal === null ? "…" : `${fmtUsdc(usdcBal)} USDC`) : csd.ready ? `${fmtCsd(csd.balance)} CSD` : "Open your CSD wallet"}</span>
            </div>
          </div>
          <div aria-live="polite">
            {preview && !problem ? (
              <div className="clause">
                {side === "buy"
                  ? `I buy ${fmtCsd(csdAmt)} CSD for ${fmtUsdc(preview.total)} USDC, paid into my Covenant CSD wallet. My USDC is held by the settlement contract and goes to the market maker only when it proves on Ethereum that it paid me; otherwise it comes back to me.`
                  : `I sell ${fmtCsd(csdAmt)} CSD for ${fmtUsdc(preview.usdc)} USDC. The market maker locks the USDC for me on Ethereum first; my CSD is sent only once that lock is there.`}
                <div className="clause-sign"><span>{isConnected ? `Signed by ${address!.slice(0, 6)}…${address!.slice(-4)}` : "Signed by your wallet"}</span><span className="sig-line" /></div>
              </div>
            ) : (!problem && <p className="clause-empty">Enter an amount to see the exact terms.</p>)}
          </div>
          {problem && <div className="form-problem danger" role="alert">{problem}</div>}
          {!isConnected ? (
            <button className="btn btn-lg" onClick={() => connect({ connector: injected() })}>Connect wallet to trade</button>
          ) : (
            <button className={`btn-lg ${side === "buy" ? "btn-buy" : "btn-sell"}`} onClick={side === "buy" ? buy : sell}
              disabled={!!busy || !CSD_ENABLED || wrongChain || (csd.ready && (!preview || !!problem))}>
              {busy ?? (wrongChain ? "Switch to Ethereum to trade" : !csd.ready ? "Open your CSD wallet" : side === "buy" ? "Sign and buy CSD" : "Sell CSD")}
            </button>
          )}
          <p className="faint" style={{ lineHeight: 1.5 }}>
            {side === "buy"
              ? "Two free signatures: the trade and a USDC permit. No approval transaction and no ETH needed."
              : "No signature needed: your CSD wallet pays once the USDC is locked for you. The USDC arrives in about half a minute."}
          </p>
        </section>

        <section className="card trades-card" aria-label="Your CSD wallet" style={{ padding: "18px 18px", alignContent: "start" }}>
          <h2 className="panel-title" style={{ fontFamily: "var(--sans)", marginBottom: 12 }}>Your CSD wallet</h2>
          {!isConnected ? (
            <p className="muted" style={{ lineHeight: 1.5 }}>Connect your Ethereum wallet to open your CSD wallet.</p>
          ) : !csd.ready ? (
            <div className="col" style={{ gap: 12 }}>
              <p className="muted" style={{ lineHeight: 1.5 }}>
                Your CSD wallet is made from a signature by your Ethereum wallet, so the same Ethereum wallet opens it on any device. Your wallet asks you to sign twice the first time, to check it gives the same keys every time.
              </p>
              <label className="check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /><span>Remember on this device</span></label>
              <button className="btn" onClick={() => csd.setup(remember).catch(e => setBanner({ kind: "danger", text: errText(e) }))} disabled={!!busy}>Open CSD wallet</button>
            </div>
          ) : (
            <div className="col" style={{ gap: 14 }}>
              <div>
                <div className="stat-label">Balance</div>
                <div className="stat" style={{ fontSize: 26 }}>{csd.loaded ? fmtCsd(csd.balance) : "…"} <span className="muted" style={{ fontSize: 15 }}>CSD</span></div>
                {incoming > 0n && <div className="faint">+{fmtCsd(incoming)} CSD on its way, spendable after its first CSD block</div>}
                {mid !== null && csd.balance > 0n && <div className="faint">≈ {fmtUsdc((csd.balance * mid) / 100_000_000n)} USDC</div>}
              </div>
              <div>
                <div className="stat-label">Receive</div>
                <button className="link-btn mono" style={{ fontSize: 13, wordBreak: "break-all", textAlign: "left" }} title="Copy"
                  onClick={() => { navigator.clipboard?.writeText(csd.main!.addr20.slice(2)); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  {csd.main!.addr20.slice(2)}
                </button>
                <div className="faint">{copied ? "Copied." : "Send CSD here from any CSD wallet."}</div>
              </div>
              <details>
                <summary className="link-btn" style={{ cursor: "pointer" }}>Send CSD</summary>
                <div className="col" style={{ gap: 8, marginTop: 10 }}>
                  <input value={sendTo} onChange={e => setSendTo(e.target.value)} placeholder="CSD address (40 characters)" autoComplete="off" spellCheck={false} />
                  <div className="field-unit"><input inputMode="decimal" value={sendAmt} onChange={e => setSendAmt(e.target.value.replace(",", "."))} placeholder="0.00" /><span className="unit">CSD</span></div>
                  <button className="btn-secondary" onClick={sendCsd} disabled={!!busy}>Send</button>
                </div>
              </details>
              <p className="faint" style={{ lineHeight: 1.5 }}>
                A wallet for trading, kept in this browser. Keep larger amounts in your own CSD wallet.{" "}
                <button className="link-btn faint" onClick={csd.forget}>Forget on this device</button>
              </p>
              {csd.error && <div className="danger" style={{ fontSize: 14 }}>Can&apos;t reach the CSD network: {csd.error}</div>}
            </div>
          )}
        </section>
      </div>

      <div className="exchange-grid two-col" style={{ marginTop: 16 }}>
        <section className="card" aria-label="Recent trades" style={{ padding: "18px 14px" }}>
          <h2 className="panel-title" style={{ fontFamily: "var(--sans)", margin: "0 6px 12px" }}>Recent trades</h2>
          <div className="book-head"><span>Price</span><span>Size (CSD)</span><span>Time</span></div>
          {!m || m.recent.length === 0 ? <div className="book-empty">No trades yet.</div> : m.recent.slice(0, 15).map((t, i) => (
            <div key={i} className="trade-row">
              <span className={t.side === "buy" ? "buy" : "sell"}>{fmtPx(BigInt(t.price))}</span>
              <span>{fmtCsd(BigInt(t.csdAmount), 2)}</span>
              <span className="muted">{new Date(t.at * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          ))}
        </section>
        <section className="card" aria-label="Your trades" style={{ padding: "18px 14px" }}>
          <h2 className="panel-title" style={{ fontFamily: "var(--sans)", margin: "0 6px 12px" }}>Your trades</h2>
          {mine.length === 0 ? <div className="book-empty">{isConnected ? "Your CSD trades will show here." : "Connect a wallet to see your trades."}</div> : (
            <table className="tbl"><tbody>
              {mine.slice(0, 15).map(t => (
                <tr key={t.authHash}>
                  <td className={t.side}>{t.side === "buy" ? "Bought" : "Sold"}</td>
                  <td>{fmtCsd(BigInt(t.csdAmount))} CSD</td>
                  <td>{fmtUsdc(BigInt(t.usdcAmount))} USDC</td>
                  <td className="muted">{t.status === "pending" ? (t.side === "buy" ? "CSD on its way" : "Releasing") : new Date(t.at).toLocaleDateString()}</td>
                  <td>{t.side === "sell" && t.status === "pending" && t.csdTxid && Date.now() - t.at > 10 * 60_000
                    ? <button className="link-btn" onClick={() => claim(t)} disabled={!!busy} title="The market maker hasn't released it. Claim the USDC yourself with a proof of your CSD payment (costs a little ETH).">Claim</button>
                    : (t.releaseTx ?? t.lockTx) && <a href={etherscanTx((t.releaseTx ?? t.lockTx)!)} target="_blank" rel="noreferrer">Tx</a>}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </section>
      </div>
      <p className="faint" style={{ margin: "18px 4px 8px", lineHeight: 1.5 }}>
        Market maker: {CSD_MM_URL ? new URL(CSD_MM_URL).host : "not set"}. Settlement contract: {CSD_SETTLEMENT || "not set"}.
        The market maker can&apos;t take your funds: buying, your USDC is released only against an on-chain proof of your CSD; selling, your CSD is sent only after the USDC is locked for you.
      </p>
    </main>
  );
}
