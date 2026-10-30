"use client";
// CSD/USDC: trade Compute Substrate for USDC with a market maker, settled by
// CsdUsdcSettlement on Ethereum. Both directions finish in about one Ethereum
// block. Buying, the user's USDC is locked by permit (no ETH needed) and only
// reaches the market maker once it proves the CSD payment on Ethereum. Selling,
// the market maker locks USDC for the user first, the page checks the lock on
// Ethereum, and only then does the in-site CSD wallet pay.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useConnect, usePublicClient, useSignTypedData, useWriteContract } from "wagmi";
import { injected } from "@wagmi/core";
import { decodeEventLog, formatUnits, hashTypedData, keccak256, parseAbiItem, parseUnits, recoverTypedDataAddress, toHex, type Address, type Hex } from "viem";
import { CHAIN_ID } from "@/config";
import { MarketTabs } from "@/market-tabs";
import {
  CSD_ENABLED, CSD_SALE_EXECUTOR_FEE, CSD_MM_URL, CSD_SETTLEMENT, CSD_USDC, CSD_GENESIS, CSD_BUY_CONFIRMATIONS, CSD_EXPLORER, CSD_NODE_URL, CSD_TARGET_REF, CSD_MARKET_MAKERS, csdSettleAbi, csdRefundAbi,
  CSD_AUTH_TYPES, PERMIT_TYPES, csdDomain, csdSettlementAbi, usdcPermitAbi, mmGet, type CsdMarket,
} from "@/csd/config";
import { addr20ToBytes32, csdAddressProof, txToNodeJson, txFromNodeJson, bitsToTarget, csdNode, csdSaleRequestDigest, csdSignDigest, type Hex as CHex, type CsdUtxo } from "@/csd/csd-wallet";
import { quoteBuy, quoteSell, midPrice, ladder, type Pool } from "@/csd/pool";
import { aonApi, buyAuthorizationObject, saleRequestObject, salePaymentObject } from "@/csd/aon-client";
import { aonFetch } from "@/endpoints";
import { useCsdWallet } from "@/csd/useCsdWallet";

type Side = "buy" | "sell";
type MyTrade = { authHash: Hex; side: Side; csdAmount: string; usdcAmount: string; at: number; lockTx?: Hex; csdTxid?: Hex; releaseTx?: Hex;
  status: "pending" | "done" | "failed"; csdAddress?: Hex; authorization?: any; signature?: Hex; csdTx?: any; lockedUntil?: number; receipt?: string;
  aonAuth?: string /* the trade's authorization object on AON */; maker?: string };
type Banner = { kind: "info" | "ok" | "danger"; text: string; links?: { href: string; label: string }[] } | null;

const etherscanTx = (tx: string) => (CHAIN_ID === 1 ? `https://etherscan.io/tx/${tx}` : "#");
const EXPLORER = "https://explorer.aon.network";
const aonLink = (hash: string) => `${EXPLORER}?hash=${hash}`;
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
  if (m === "NO_OFFER") return "No market maker is quoting right now. Try again shortly.";
  if (m === "MARKET_FULL") return "The market is at its limit for open trades right now (all trades together are capped while they settle). Nothing was traded; try again shortly.";
  if (m === "TRY_ANOTHER_MAKER") return "That market maker couldn't take it right now, so nothing was traded. Try again in a minute or two.";
  if (m === "NO_RESPONSE") return "The market maker didn't answer. Nothing was traded.";
  if (m === "NO_RESPONSE_BUY") return "No answer from the market maker yet. If it takes the trade, it shows up in Your trades; otherwise nothing happens.";
  if (m === "SELLS_PAUSED") return "Selling is paused for a little while. Try again later.";
  if (m === "MARKET_MAKER_PAUSED") return "The market maker is paused for a moment. Nothing was traded; try again later.";
  if (m === "FINISH_YOUR_OTHER_BUY") return "Your previous buy is still being locked. Try again in a few seconds.";
  if (m === "NOT_ENOUGH_USDC") return "Your wallet doesn't have enough USDC for that.";
  if (m === "SLOW_DOWN") return "Too many requests. Wait a minute and try again.";
  if (m === "ADDRESS_FROM_A_DOUBLE_SPEND") return "This CSD address can't sell right now.";
  if (m.startsWith("COINS_") || m === "NOT_ENOUGH_COINS") return "Some of your CSD is still being confirmed or is tied up in another sale. Try again after the next CSD block.";
  if (m === "FINISH_YOUR_OTHER_SALE" || m === "TOO_MANY_UNPAID_SALES") return "Finish or wait out your other sale first.";
  if (m === "TOO_LATE_TO_PAY") return "That offer expired before your CSD was sent. Nothing was sent; try again.";
  if (m.startsWith("PRICE_MOVED")) return "The price moved while you were signing. Check the new price and try again.";
  if (m === "BUSY_TRY_AGAIN_SHORTLY") return "The market maker is busy with other trades. Try again in a minute.";
  if (m.startsWith("NOT_ENOUGH_")) return "The market maker can't fill that size right now. Try a smaller amount.";
  if (m.startsWith("CSD_MAX_TARGET") || m.startsWith("VALID_BEFORE") || m === "FEE_TOO_LOW") return "The market maker's terms just changed. Reload the page and try again.";
  if (m.startsWith("LOCK_REJECTED")) return "The USDC lock didn't go through, so nothing was traded. Try again in a minute or two.";
  return m;
};

// CSD's current difficulty target from a node the site trusts (not the market
// maker), or null when the build has none
const independentNode = CSD_NODE_URL ? csdNode(CSD_NODE_URL) : null;
// (if the build names an independent node and it can't be reached, nothing is traded)
async function trustedCsdTarget(): Promise<bigint | null> {
  if (!independentNode) return null;
  try {
    const tip = await independentNode.tip();
    return bitsToTarget(Number((await independentNode.headerAt(tip.height)).bits));
  } catch { throw new Error("Can't reach the CSD network to check its difficulty right now. Nothing was traded; try again shortly."); }
}
// The easiest difficulty a buy may sign for: the real one (live, with 10% slack),
// or twice the build's reference. Easier than that and fake CSD blocks get cheap.
async function maxBuyTarget(): Promise<bigint> {
  const live = await trustedCsdTarget();
  return live !== null ? live * 11n / 10n : CSD_TARGET_REF * 2n;
}
// The hardest difficulty a market maker's lock may demand for your sale, so that
// you could still prove your payment yourself: about the real one (live), or twice the reference.
async function minSellTarget(): Promise<bigint> {
  const live = await trustedCsdTarget();
  return live !== null ? live * 9n / 10n : CSD_TARGET_REF / 2n;
}
const work = (target: bigint) => (1n << 256n) / (target + 1n);

// Trading goes over AON (with the site's node failover): offers, requests, responses
const aon = aonApi("", ((u: any, i: any) => aonFetch(String(u), i)) as typeof fetch);
// Anyone can be a market maker: the page finds every maker's signed offers on AON, merges them
// into one book and sends each trade to the best price. No maker is trusted: the contract and the
// checks below protect the trade whoever is on the other side.
type Maker = { addr: string; sell?: any; buy?: any };
type Market = { makers: Maker[]; asks: { price: bigint; csd: bigint }[]; bids: { price: bigint; csd: bigint }[];
  bestAsk: bigint | null; bestBid: bigint | null; recent: CsdMarket["recent"] };
type Route = { maker: string; offer: any; usdc: bigint; fee: bigint; total: bigint };
const poolOf = (o: any): Pool => ({ usdc: BigInt(o.payload.poolUsdc), csd: BigInt(o.payload.poolCsd), spreadBps: BigInt(o.payload.spreadBps) });
// Makers that declined or didn't answer are skipped for a while (remembered in this browser)
const AVOID_KEY = "covenant.csd.avoid";
const avoid = new Map<string, number>((() => { try { return Object.entries(JSON.parse(localStorage.getItem(AVOID_KEY) ?? "{}")) as [string, number][]; } catch { return []; } })());
function skipMaker(addr: string, ms = 30 * 60_000) {
  forgetProven(addr);
  avoid.set(addr.toLowerCase(), Date.now() + ms);
  try { localStorage.setItem(AVOID_KEY, JSON.stringify(Object.fromEntries([...avoid].filter(([, t]) => t > Date.now())))); } catch {}
}
// A maker is proven once a trade of its has settled on Ethereum (from its signed receipts, checked
// on chain), or if the site lists it. Trades go to proven makers; a new maker gets orders after its
// first settled trade, so a fake maker with tempting prices costs more than an address.
type Reader = (txHash: Hex) => Promise<{ logs: { address: string; data: Hex; topics: Hex[] }[] } | null>;
// Only a settlement proven with a CSD payment counts (an early release needs no CSD at all, so two
// addresses of one person could make any number of those for the price of gas)
const SETTLED_EVENTS = [
  parseAbiItem("event CsdUsdcSettled(bytes32 indexed authHash, bytes32 indexed csdTxid, address indexed buyer, address sellerUsdcRecipient, address usdc, uint256 usdcAmount, uint256 csdAmount)"),
];
const RELEASED_EARLY = parseAbiItem("event CsdUsdcReleasedEarly(bytes32 indexed authHash, bytes32 indexed csdTxid, address indexed buyer, address sellerUsdcRecipient, address usdc, uint256 usdcAmount, uint256 csdAmount)");
// A receipt is real if the transaction it names settled exactly that trade on the contract, the
// maker who signed it was a party to it, and the amounts match. (Checked once per receipt.)
const verified = new Map<string, "settled" | "released" | null>(); // receipt hash → how it really settled
async function realReceipt(o: any, read: Reader): Promise<"settled" | "released" | null> {
  if (verified.has(o.objectHash)) return verified.get(o.objectHash)!;
  let ok: "settled" | "released" | null = null;
  try {
    const rc = /^0x[0-9a-fA-F]{64}$/.test(String(o.payload?.executionTx)) ? await read(o.payload.executionTx) : null;
    for (const l of rc?.logs ?? []) {
      if (l.address.toLowerCase() !== CSD_SETTLEMENT.toLowerCase()) continue;
      let ev: any = null, kind: "settled" | "released" = "settled";
      for (const abi of SETTLED_EVENTS) { try { ev = decodeEventLog({ abi: [abi], data: l.data, topics: l.topics as any }); break; } catch {} }
      if (!ev) { try { ev = decodeEventLog({ abi: [RELEASED_EARLY], data: l.data, topics: l.topics as any }); kind = "released"; } catch {} }
      if (!ev) continue;
      const x = ev.args;
      const match = String(x.authHash).toLowerCase() === String(o.payload.authHash).toLowerCase()
        && (String(x.buyer).toLowerCase() === o.signer || String(x.sellerUsdcRecipient).toLowerCase() === o.signer)
        && String(x.buyer).toLowerCase() !== String(x.sellerUsdcRecipient).toLowerCase()
        && String(x.usdcAmount) === String(o.payload.usdcAmount) && String(x.csdAmount) === String(o.payload.csdAmount)
        && String(x.buyer).toLowerCase() === String(o.payload.buyer).toLowerCase() && String(x.sellerUsdcRecipient).toLowerCase() === String(o.payload.sellerUsdcRecipient).toLowerCase();
      if (match) { ok = kind; break; }
    }
  } catch {}
  verified.set(o.objectHash, ok);
  return ok;
}
// Makers proven before are remembered in this browser for 30 days (receipts can be pushed out of
// view by others), and forgotten as soon as one declines or doesn't answer
const PROVEN_KEY = "covenant.csd.proven2";
const provenMap = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(PROVEN_KEY) ?? "{}"); } catch { return {}; } };
const provenBefore = (): string[] => Object.entries(provenMap()).filter(([, t]) => t > Date.now() - 30 * 86400_000).map(([a]) => a);
function rememberProven(addrs: string[]) {
  const m = provenMap(); for (const a of addrs) m[a] = Date.now();
  try { localStorage.setItem(PROVEN_KEY, JSON.stringify(Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 200)))); } catch {}
}
function forgetProven(addr: string) { const m = provenMap(); delete m[addr.toLowerCase()]; try { localStorage.setItem(PROVEN_KEY, JSON.stringify(m)); } catch {} }
const OFFERS_KEY = "covenant.csd.offers";
const remembered = (): string[] => { try { return JSON.parse(localStorage.getItem(OFFERS_KEY) ?? "[]"); } catch { return []; } };
async function loadMarket(read?: Reader): Promise<Market> {
  // Offer hashes to start from: the ones seen last time, and the known market makers' own
  let info: CsdMarket | null = null;
  try { info = await mmGet<CsdMarket>("/market"); } catch {}
  const all = await aon.allOffers([info?.offers?.sell, info?.offers?.buy, ...remembered()].filter(Boolean) as string[]);
  const ours = (o: any) => !!o && String(o.payload.settlementContract).toLowerCase() === CSD_SETTLEMENT.toLowerCase()
    && String(o.payload.usdc).toLowerCase() === CSD_USDC.toLowerCase() && String(o.payload.csdGenesisHash).toLowerCase() === CSD_GENESIS.toLowerCase();
  const makers: Maker[] = [...all].map(([addr, x]) => ({ addr, sell: ours(x.sell) ? x.sell : undefined, buy: ours(x.buy) ? x.buy : undefined })).filter(x => x.sell || x.buy);
  if (!makers.length) throw new Error("NO_OFFER");
  // Receipts, kept only if they match a real settlement on Ethereum that their maker was part of
  const known = new Set(CSD_MARKET_MAKERS.map(x => x.toLowerCase()));
  const real: any[] = [];
  try {
    for (const o of await aon.receipts(makers.map(x => x.addr), 40)) {
      if (String(o.payload?.settlementContract).toLowerCase() !== CSD_SETTLEMENT.toLowerCase() || !(BigInt(o.payload?.csdAmount ?? 0) > 0n)) continue;
      const k = read ? await realReceipt(o, read) : null;
      if (k) real.push({ ...o, how: k });
    }
  } catch {}
  const provenNow = real.filter(o => o.how === "settled").map(o => o.signer);
  const proven = new Set([...known, ...provenBefore(), ...provenNow]);
  rememberProven(provenNow);
  // Trades (and the book) use proven makers on each side; if none is quoting a side, any maker
  for (const side of ["sell", "buy"] as const) {
    const anyProven = makers.some(x => x[side] && proven.has(x.addr));
    if (anyProven) for (const x of makers) if (!proven.has(x.addr)) x[side] = undefined;
  }
  try { localStorage.setItem(OFFERS_KEY, JSON.stringify(makers.flatMap(x => [x.sell?.objectHash, x.buy?.objectHash]).filter(Boolean).slice(0, 40))); } catch {}
  // The book: every maker's levels together
  const levels = (side: "asks" | "bids") => makers.flatMap(x => { const o = side === "asks" ? x.sell : x.buy; if (!o) return []; try { return ladder(poolOf(o), 5_000_000n, 8)[side]; } catch { return []; } });
  const asks = levels("asks").sort((a, b) => (a.price < b.price ? -1 : 1)).slice(0, 8);
  const bids = levels("bids").sort((a, b) => (a.price > b.price ? -1 : 1)).slice(0, 8);
  const best = (f: (x: Maker) => bigint | null, lowest: boolean) => makers.map(f).filter((v): v is bigint => v !== null).reduce<bigint | null>((a, b) => a === null || (lowest ? b < a : b > a) ? b : a, null);
  const bestAsk = best(x => { try { return x.sell ? quoteBuy(poolOf(x.sell), 100_000_000n) : null; } catch { return null; } }, true);
  const bestBid = best(x => { try { return x.buy ? quoteSell(poolOf(x.buy), 100_000_000n) : null; } catch { return null; } }, false);
  // Recent trades: makers' signed receipts of trades settled on Ethereum (or the known maker's own list)
  let recent: CsdMarket["recent"] = [];
  try {
    recent = real
      .map(o => ({ side: String(o.payload.buyer).toLowerCase() === o.signer ? "sell" : "buy", csdAmount: String(o.payload.csdAmount), usdcAmount: String(o.payload.usdcAmount),
        price: String(BigInt(o.payload.usdcAmount) * 100_000_000n / BigInt(o.payload.csdAmount)), at: Math.floor(Number(o.createdAt) / 1000) })) as any;
  } catch {}
  if (!recent.length) recent = info?.recent ?? [];
  return { makers, asks, bids, bestAsk, bestBid, recent };
}
// The best maker for a trade of `csd` (buy: least USDC to pay; sell: most USDC received), within each maker's limits
function routes(mk: Market, side: Side, csd: bigint): Route[] {
  const out: Route[] = [];
  for (const x of mk.makers) {
    const o = side === "buy" ? x.sell : x.buy; if (!o || (avoid.get(x.addr) ?? 0) > Date.now()) continue;
    try {
      const fee = BigInt(o.payload.feeUsdc), p = poolOf(o);
      const usdc = side === "buy" ? quoteBuy(p, csd) : quoteSell(p, csd) - fee;
      const size = side === "buy" ? usdc + fee : usdc + CSD_SALE_EXECUTOR_FEE; // (a sale's lock also holds the executor fee)
      if (usdc <= 0n || size > BigInt(o.payload.maxTradeUsdc) || usdc < BigInt(o.payload.minTradeUsdc)) continue;
      out.push({ maker: String(o.payload.marketMaker), offer: o, usdc, fee, total: side === "buy" ? usdc + fee : usdc });
    } catch {}
  }
  return out.sort((a, b) => side === "buy" ? (a.total < b.total ? -1 : 1) : (a.total > b.total ? -1 : 1));
}
// Ordinary "not right now" answers skip a maker briefly; silence or anything odd, for longer.
// (Answers are the maker's own words, so none of them stops the page from trying another maker.)
const BRIEF = /^(PRICE_MOVED|TRADE_SIZE|NOT_ENOUGH_|BUSY|SELLS_PAUSED|MARKET_MAKER_PAUSED|COINS_|FINISH_YOUR_|TOO_MANY_UNPAID|ADDRESS_FROM|SLOW_DOWN|REQUEST_EXPIRED|NAME_YOUR_COINS|CSD_|LOCK_REJECTED|VALID_|CONFIRMATIONS_|FEE_TOO_LOW|WRONG_)/;
const skipFor = (err: string) => BRIEF.test(err) ? 2 * 60_000 : 30 * 60_000;

// The market maker's signed answer to one of our objects
async function answer(objectHash: string, marketMaker: string, timeoutMs = 45_000) {
  const r = await aon.response(objectHash, marketMaker, timeoutMs);
  if (!r.accepted) throw new Error(r.error ?? "DECLINED");
  return r;
}

export default function CsdMarketPage() {
  const { address, isConnected, chainId } = useAccount();
  const { connect } = useConnect();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const csd = useCsdWallet(address);
  const reader = useMemo<Reader | undefined>(() => publicClient
    ? (h) => publicClient.getTransactionReceipt({ hash: h }).then(r => r as any, () => null) : undefined, [publicClient]);
  const [m, setM] = useState<Market | null>(null);
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
    const load = () => loadMarket(reader).then(x => { if (live) { setM(x); setMErr(""); } }).catch(e => live && setMErr(e.message));
    load(); const id = setInterval(load, 10_000);
    return () => { live = false; clearInterval(id); };
  }, [reader]);

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
  // USDC balance: every 15 s, every 3 s for a minute after a trade
  const [fastUntil, setFastUntil] = useState(0);
  const watchUsdc = useCallback(() => { setFastUntil(Date.now() + 60_000); readUsdc(); }, [readUsdc]);
  useEffect(() => {
    readUsdc();
    const id = setInterval(readUsdc, Date.now() < fastUntil ? 3000 : 15000);
    const stop = Date.now() < fastUntil ? setTimeout(() => setFastUntil(0), fastUntil - Date.now()) : undefined;
    return () => { clearInterval(id); if (stop) clearTimeout(stop); };
  }, [readUsdc, fastUntil]);

  // Follow trades until their AON receipt is out: sells released, buys settled
  useEffect(() => {
    const open = mine.filter(t => !t.receipt && t.status !== "failed" && Date.now() - t.at < 6 * 3600_000 && (t.side === "buy" || t.csdTxid));
    // Buys that failed can still be locked by anyone until they expire (their permit was public): watched, so Refund can appear
    const maybe = mine.filter(t => t.side === "buy" && t.status === "failed" && !t.releaseTx && t.authorization && Number(t.authorization.validBefore) * 1000 > Date.now() - 6 * 3600_000);
    if (!open.length && !maybe.length) return;
    const id = setInterval(async () => {
      for (const t of maybe) {
        try {
          if (await publicClient?.readContract({ address: CSD_SETTLEMENT, abi: csdSettlementAbi, functionName: "usdcLocked", args: [t.authHash as Hex] }))
            saveTrade({ ...t, status: "pending", lockedUntil: Number(await publicClient!.readContract({ address: CSD_SETTLEMENT, abi: csdSettlementAbi, functionName: "lockedUntil", args: [t.authHash as Hex] })) });
        } catch {}
      }
      for (const t of open) {
        if (!t.aonAuth) continue;
        try {
          // The market maker's receipt references the trade's authorization
          // Sales: done once final on Ethereum (whoever released or settled it)
          if (t.side === "sell" && t.status === "pending" && publicClient
            && await publicClient.readContract({ address: CSD_SETTLEMENT, abi: csdSettlementAbi, functionName: "finalizedAuthorization", args: [t.authHash as Hex] }).catch(() => false)) {
            saveTrade({ ...t, status: "done" }); readUsdc(); continue;
          }
          const rc = await aon.receipt(t.aonAuth, t.authHash, t.maker ? [t.maker] : CSD_MARKET_MAKERS);
          if (rc && (t.side === "buy" || t.status === "done")) saveTrade({ ...t, receipt: rc.objectHash });
        } catch {}
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [mine, saveTrade, readUsdc, publicClient]);

  // pending buys: CSD is on its way until a coin shows up at the trade's address
  const incoming = mine.filter(t => t.side === "buy" && t.status === "pending").reduce((s, t) => s + BigInt(t.csdAmount), 0n);
  useEffect(() => {
    for (const t of mine) if (t.side === "buy" && t.status === "pending" && t.csdAddress
      && csd.coins.filter(c => c.key.addr20 === t.csdAddress).reduce((s, c) => s + c.value, 0n) >= BigInt(t.csdAmount)) saveTrade({ ...t, status: "done" });
  }, [csd.coins, mine, saveTrade]);

  const csdAmt = parseCsd(amount);
  const best = useMemo(() => (m && csdAmt > 0n ? routes(m, side, csdAmt)[0] ?? null : null), [m, csdAmt, side]);
  const fee = best?.fee ?? 0n;
  const preview = best ? { usdc: best.usdc, total: best.total } : null;

  const problem = (() => {
    if (!m || csdAmt === 0n) return "";
    if (csdAmt < 0n) return "Enter an amount like 25 or 12.5.";
    if (!preview) {
      // Why not: below every maker's smallest trade, above every maker's largest, or none quoting
      const offers = m.makers.map(x => side === "buy" ? x.sell : x.buy).filter(Boolean);
      // (as routes() measures them: the USDC amount, and the lock size including fees)
      const raw = offers.map(o => { try { const p = poolOf(o), f = BigInt(o.payload.feeUsdc);
        return side === "buy" ? quoteBuy(p, csdAmt) : quoteSell(p, csdAmt) - f; } catch { return null; } });
      const locks = offers.map((o, i) => raw[i] === null ? null : side === "buy" ? raw[i]! + BigInt(o.payload.feeUsdc) : raw[i]! + CSD_SALE_EXECUTOR_FEE);
      const minT = offers.reduce<bigint | null>((a, o) => { const v = BigInt(o.payload.minTradeUsdc); return a === null || v < a ? v : a; }, null);
      const maxT = offers.reduce<bigint | null>((a, o) => { const v = BigInt(o.payload.maxTradeUsdc); return a === null || v > a ? v : a; }, null);
      const best = side === "buy" ? m.bestAsk : m.bestBid;
      if (!offers.length) return side === "buy" ? "Nobody is selling CSD right now." : "Nobody is buying CSD right now.";
      if (offers.every(o => (avoid.get(String(o.payload.marketMaker).toLowerCase()) ?? 0) > Date.now()))
        return "The market maker couldn't take your last trade. Try again in a minute or two.";
      if (minT !== null && raw.every(v => v !== null && v < minT)) {
        // (a sale's fee comes out of what you receive, so it takes a little more CSD)
        const need = side === "sell" ? minT + BigInt(offers[0]!.payload.feeUsdc) : minT;
        const csdMin = best ? (need * 100_000_000n) / best + 100_000_000n : null;
        return `The smallest trade is ${fmtUsdc(minT)} USDC${csdMin ? ` (about ${fmtCsd(csdMin - (csdMin % 100_000_000n))} CSD)` : ""}.`;
      }
      if (maxT !== null && locks.every(v => v === null || v > maxT)) return `Trades are limited to ${fmtUsdc(maxT)} USDC each for now.`;
      return "No market maker can take that size right now. Try a smaller amount.";
    }
    if (side === "buy" && usdcBal !== null && preview.total > usdcBal) return `You have ${fmtUsdc(usdcBal)} USDC.`;
    if (side === "sell" && csd.ready && csd.loaded && csdAmt + 10_000n > csd.balance) return `Your CSD wallet has ${fmtCsd(csd.balance)} CSD ready to spend.`;
    return "";
  })();

  // The contract caps all open locks together (shared by every maker); a trade that wouldn't fit fails
  async function marketFull(amount: bigint) {
    try {
      const [tl, max] = await Promise.all([
        publicClient!.readContract({ address: CSD_SETTLEMENT, abi: csdSettlementAbi, functionName: "totalLocked" }),
        publicClient!.readContract({ address: CSD_SETTLEMENT, abi: csdSettlementAbi, functionName: "maxTotalLocked" }),
      ]) as [bigint, bigint];
      return tl + amount > max;
    } catch { return false; }
  }

  async function buy() {
    if (!address || !publicClient || !m || !preview) return;
    setBanner(null);
    try {
      let w = csd.wallet;
      if (!w) { setBusy("Confirm in your wallet…"); w = await csd.setup(remember); }
      setBusy("Confirm in your wallet (1/2)…");
      const fresh = await loadMarket(reader); setM(fresh);
      const rt = routes(fresh, "buy", csdAmt)[0]; if (!rt) throw new Error("NO_OFFER");
      if (await marketFull(rt.total)) throw new Error("MARKET_FULL");
      const usdcAmount = rt.usdc, feeAmt = rt.fee, maker = rt.maker;
      if (usdcAmount + feeAmt > preview.total * 1005n / 1000n) throw new Error(`PRICE_MOVED`);
      // The difficulty comes from the site's own bound, not from the market maker
      const csdMaxTarget = await maxBuyTarget();
      const key = csd.freshKey(w);
      const t = Math.floor(Date.now() / 1000);
      const auth = { buyer: address, sellerUsdcRecipient: maker as Hex, sellerCsdScriptHash: addr20ToBytes32(key.addr20) as Hex, csdGenesisHash: CSD_GENESIS,
        // Names the market maker's published offer, so the authorization links to it on AON
        tradeIntentHash: rt.offer.objectHash as Hex, csdAmount: csdAmt, usdc: CSD_USDC, usdcAmount, minConfirmations: CSD_BUY_CONFIRMATIONS,
        csdMaxTarget, executorFeeAmount: feeAmt, validAfter: BigInt(t - 120), validBefore: BigInt(t + 3 * 3600),
        nonce: toHex(crypto.getRandomValues(new Uint8Array(32))) };
      const signature = await signTypedDataAsync({ domain: csdDomain(), types: CSD_AUTH_TYPES, primaryType: "CsdUsdcAuthorization", message: auth });
      const authHash = hashTypedData({ domain: csdDomain(), types: CSD_AUTH_TYPES, primaryType: "CsdUsdcAuthorization", message: auth });
      setBusy("Confirm in your wallet (2/2)…");
      const [name, version, nonce] = await Promise.all([
        publicClient.readContract({ address: CSD_USDC, abi: usdcPermitAbi, functionName: "name" }),
        publicClient.readContract({ address: CSD_USDC, abi: usdcPermitAbi, functionName: "version" }),
        publicClient.readContract({ address: CSD_USDC, abi: usdcPermitAbi, functionName: "nonces", args: [address] }),
      ]) as [string, string, bigint];
      const deadline = BigInt(t + 300); // short: if this trade doesn't happen now, the permit can't be used later
      const ps = await signTypedDataAsync({ domain: { name, version, chainId: CHAIN_ID, verifyingContract: CSD_USDC }, types: PERMIT_TYPES, primaryType: "Permit",
        message: { owner: address, spender: CSD_SETTLEMENT, value: usdcAmount + feeAmt, nonce, deadline } });
      setBusy("Buying…");
      // Published on AON, referencing the offer; the market maker answers there
      const obj = buyAuthorizationObject({ offerHash: rt.offer.objectHash, authorization: auth, signature, domain: csdDomain(), types: CSD_AUTH_TYPES,
        addressProof: csdAddressProof(key, authHash as CHex), permit: { deadline, r: ps.slice(0, 66) as Hex, s: ("0x" + ps.slice(66, 130)) as Hex, v: parseInt(ps.slice(130, 132), 16) } });
      const trade: MyTrade = { authHash, side: "buy", csdAmount: String(csdAmt), usdcAmount: String(usdcAmount + feeAmt), at: Date.now(), status: "pending", csdAddress: key.addr20 as Hex,
        authorization: Object.fromEntries(Object.entries(auth).map(([k, v]) => [k, String(v)])), signature, aonAuth: obj.objectHash, maker };
      await aon.put(obj);
      saveTrade(trade); // (so it's followed even if the answer is slow)
      let r: any;
      try { r = await answer(obj.objectHash!, maker); }
      catch (e: any) {
        // Silent or declining: this maker is skipped for a while, so the next try goes elsewhere.
        // (The trade stays followed: if anyone locks it anyway, Refund appears once the lock expires.)
        skipMaker(maker, skipFor(e.message));
        if (e.message === "NO_RESPONSE") throw new Error("NO_RESPONSE_BUY");
        saveTrade({ ...trade, status: "failed" });
        if (routes(fresh, "buy", csdAmt).length > 0) throw new Error("TRY_ANOTHER_MAKER");
        throw e;
      }
      saveTrade({ ...trade, lockTx: r.lockTx });
      // From a maker this site doesn't know, "Bought" only once the lock is really on Ethereum
      // (its word isn't enough; either way the contract keeps the USDC safe)
      let locked = CSD_MARKET_MAKERS.some(x => x.toLowerCase() === maker.toLowerCase());
      for (let i = 0; i < 40 && !locked; i++) {
        locked = await publicClient.readContract({ address: CSD_SETTLEMENT, abi: csdSettlementAbi, functionName: "usdcLocked", args: [authHash] }).catch(() => false) as boolean;
        if (!locked) await sleep(1500);
      }
      setAmount("");
      setBanner(locked
        ? { kind: "ok", text: `Bought ${fmtCsd(csdAmt)} CSD for ${fmtUsdc(usdcAmount + feeAmt)} USDC.`, links: r.lockTx ? [{ href: etherscanTx(r.lockTx), label: "USDC lock" }] : [] }
        : { kind: "info", text: "The market maker accepted, but its USDC lock isn't on Ethereum yet. If it never appears, nothing is taken from you; the trade shows in Your trades." });
      watchUsdc();
    } catch (e) { setBanner({ kind: "danger", text: errText(e) }); }
    finally { setBusy(null); }
  }

  async function sell() {
    if (!address || !publicClient || !m || !preview) return;
    setBanner(null);
    try {
      if (!csd.wallet) { setBusy("Confirm in your wallet…"); await csd.setup(remember); setBusy(null); return; }
      setBusy("Selling…");
      const minOut = preview.usdc * 995n / 1000n;
      const fresh = await loadMarket(reader); setM(fresh);
      if (await marketFull(preview.usdc + CSD_SALE_EXECUTOR_FEE)) throw new Error("MARKET_FULL");
      const candidates = routes(fresh, "sell", csdAmt).filter(x => x.usdc >= minOut).slice(0, 3);
      if (!candidates.length) throw new Error("PRICE_MOVED");
      // Name the exact coins this sale will be paid with, signed by their keys
      const pick = csd.pay([{ value: csdAmt, addr20: ("0x" + "00".repeat(20)) as Hex }]);
      const coins = pick.spent.map(sp => csd.coins.find(c => c.txid === sp.txid && c.vout === sp.vout)!) as CsdUtxo[];
      const req = { csdAmount: csdAmt, usdcRecipient: address, validUntil: Math.floor(Date.now() / 1000) + 300, coins: coins.map(c => ({ txid: c.txid, vout: c.vout })) };
      const digest = csdSaleRequestDigest(req);
      const signers = [...new Map(coins.map(c => [c.key.addr20, c.key])).values()];
      // The best maker first; if it can't take it right now, the next (no wallet prompts: the request is signed here)
      let o: any = null, maker = "";
      for (const c of candidates) {
        const reqObj = saleRequestObject({ offerHash: c.offer.objectHash, csdAmount: csdAmt, usdcRecipient: address, minUsdcOut: minOut, validUntil: req.validUntil,
          coins: req.coins as any, proofs: signers.map(k => csdSignDigest(k, digest)), owners: signers.map(k => k.addr20) });
        await aon.put(reqObj);
        try { o = await answer(reqObj.objectHash!, c.maker, 20_000); maker = c.maker; break; }
        catch (e: any) {
          skipMaker(c.maker, skipFor(e.message));
          if (c === candidates[candidates.length - 1]) throw e;
        }
      }
      // Check everything ourselves before any CSD leaves the wallet
      const a = o.authorization ?? {};
      const auth = { ...a, csdAmount: BigInt(a.csdAmount), usdcAmount: BigInt(a.usdcAmount), minConfirmations: BigInt(a.minConfirmations), csdMaxTarget: BigInt(a.csdMaxTarget),
        executorFeeAmount: BigInt(a.executorFeeAmount), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) };
      const authHash = hashTypedData({ domain: csdDomain(), types: CSD_AUTH_TYPES, primaryType: "CsdUsdcAuthorization", message: auth });
      // ...including that you could prove the payment yourself if the market maker never released:
      // a difficulty real blocks meet, and enough time on the lock for its confirmations
      // The maker's own signature over it (without it you couldn't claim the USDC yourself), and an
      // executor fee in the lock, so that anyone can settle it for you if the maker never releases
      const signer = await recoverTypedDataAddress({ domain: csdDomain(), types: CSD_AUTH_TYPES, primaryType: "CsdUsdcAuthorization", message: auth as any, signature: o.signature }).catch(() => null);
      const ok = authHash === o.authHash && auth.sellerUsdcRecipient?.toLowerCase() === address.toLowerCase() && auth.csdAmount === csdAmt
        && String(auth.buyer).toLowerCase() === maker.toLowerCase() && signer?.toLowerCase() === maker.toLowerCase()
        && auth.executorFeeAmount >= CSD_SALE_EXECUTOR_FEE
        && auth.usdcAmount >= minOut && auth.usdc?.toLowerCase() === CSD_USDC.toLowerCase() && auth.csdGenesisHash?.toLowerCase() === CSD_GENESIS.toLowerCase()
        && auth.minConfirmations <= 20n && auth.csdMaxTarget >= await minSellTarget()
        && auth.sellerCsdScriptHash?.toLowerCase() === addr20ToBytes32(o.csdAddress).toLowerCase();
      if (!ok) throw new Error("The market maker's offer didn't match what you asked for. Nothing was sent.");
      saveTrade({ authHash, side: "sell", csdAmount: String(csdAmt), usdcAmount: String(auth.usdcAmount), at: Date.now(), lockTx: o.lockTx, status: "pending", authorization: a, signature: o.signature, aonAuth: o.aon?.auth, maker });
      setBusy("Selling…");
      for (let i = 0; ; i++) {
        const [locked, until] = await Promise.all([
          publicClient.readContract({ address: CSD_SETTLEMENT, abi: csdSettlementAbi, functionName: "usdcLocked", args: [authHash] }),
          publicClient.readContract({ address: CSD_SETTLEMENT, abi: csdSettlementAbi, functionName: "lockedUntil", args: [authHash] }),
        ]) as [boolean, bigint];
        if (locked && Number(until) - Date.now() / 1000 > Number(auth.minConfirmations) * 240 + 300) break;
        if (i > 60) throw new Error("The USDC lock didn't appear on Ethereum. Nothing was sent; you can try again.");
        await sleep(2000);
      }
      // Locked by a direct call to the settlement contract carrying the maker's signature, so that
      // anyone (a watchtower) can read the sale from Ethereum and settle it for you if needed
      {
        const tx = o.lockTx ? await publicClient.getTransaction({ hash: o.lockTx }).catch(() => null) : null;
        const rc = o.lockTx ? await publicClient.getTransactionReceipt({ hash: o.lockTx }).catch(() => null) : null;
        const direct = !!tx && !!rc && rc.status === "success" && tx.to?.toLowerCase() === CSD_SETTLEMENT.toLowerCase()
          && tx.input.toLowerCase().includes(String(o.signature).slice(2, 132).toLowerCase())
          && rc.logs.some(l => l.address.toLowerCase() === CSD_SETTLEMENT.toLowerCase() && l.topics[1]?.toLowerCase() === authHash.toLowerCase());
        if (!direct) throw new Error("The market maker's lock isn't one anyone could settle for you. Nothing was sent.");
      }
      setBusy("Selling…");
      const p = csd.pay([{ value: csdAmt, addr20: o.csdAddress }], coins);
      // Saved before it's handed over, so the sale can always be claimed with a proof
      saveTrade({ authHash, side: "sell", csdAmount: String(csdAmt), usdcAmount: String(auth.usdcAmount), at: Date.now(), lockTx: o.lockTx, csdTxid: p.txid, status: "pending", authorization: a, signature: o.signature, csdTx: txToNodeJson(p.tx), aonAuth: o.aon?.auth, maker });
      // Handed to the maker on AON, then broadcast by us too, whatever the maker does (answer or
      // not, within 20 s): once it's public the payment goes through either way, so the maker can't
      // hold it back, and with it in a block the USDC can always be claimed with a proof
      const payObj = salePaymentObject({ authorizationObjectHash: o.aon?.auth, authHash, authorization: a, authorizationSignature: o.signature, csdTxid: p.txid, csdTx: txToNodeJson(p.tx) });
      let r: any = {};
      try { await aon.put(payObj); r = await answer(payObj.objectHash!, maker, 20_000); } catch { r = {}; }
      finally {
        await csdNode(CSD_NODE_URL || `${CSD_MM_URL}/api/csd`).submit(p.tx).catch(() => {});
        independentNode?.submit(p.tx).catch(() => {});
        csd.spentLocally(new Set(p.spent.map(s => s.txid)));
      }
      saveTrade({ authHash, side: "sell", csdAmount: String(csdAmt), usdcAmount: String(auth.usdcAmount), at: Date.now(), lockTx: o.lockTx, csdTxid: p.txid, releaseTx: r.releaseTx, status: "pending", authorization: a, signature: o.signature, csdTx: txToNodeJson(p.tx), aonAuth: o.aon?.auth, maker });
      setAmount("");
      // Done only when Ethereum says so (the maker's word isn't enough)
      let done = false;
      if (r.releaseTx) { setBusy("Selling…"); await publicClient.waitForTransactionReceipt({ hash: r.releaseTx }).catch(() => {}); }
      done = await publicClient.readContract({ address: CSD_SETTLEMENT, abi: csdSettlementAbi, functionName: "finalizedAuthorization", args: [authHash] }).catch(() => false) as boolean;
      if (done) {
        saveTrade({ authHash, side: "sell", csdAmount: String(csdAmt), usdcAmount: String(auth.usdcAmount), at: Date.now(), lockTx: o.lockTx, csdTxid: p.txid, releaseTx: r.releaseTx, status: "done", authorization: a, signature: o.signature, csdTx: txToNodeJson(p.tx), aonAuth: o.aon?.auth, maker });
        setBanner({ kind: "ok", text: `Sold ${fmtCsd(csdAmt)} CSD for ${fmtUsdc(auth.usdcAmount)} USDC.`, links: r.releaseTx ? [{ href: etherscanTx(r.releaseTx), label: "Transaction" }] : [] });
      } else {
        setBanner({ kind: "info", text: `Your ${fmtCsd(csdAmt)} CSD is paid. ${fmtUsdc(auth.usdcAmount)} USDC arrives when the market maker releases it, usually within minutes. If it doesn't, Claim appears in Your trades, and a watchtower can claim it for you.` });
      }
      watchUsdc(); setTimeout(csd.refresh, 3000);
    } catch (e) { setBanner({ kind: "danger", text: errText(e) }); }
    finally { setBusy(null); }
  }

  // If the market maker never releases a sale you paid for, claim it yourself
  // with a proof of your CSD payment (you pay the Ethereum gas)
  async function claim(t: MyTrade) {
    if (!t.authorization || !t.signature || !t.csdTxid || !publicClient) return;
    setBanner(null); setBusy("Claiming…");
    try {
      const a = t.authorization, conf = Number(a.minConfirmations);
      const base = CSD_NODE_URL || `${CSD_MM_URL}/api/csd`;
      if (t.csdTx) { const n = csdNode(base); await n.submit(txFromNodeJson(t.csdTx)).catch(() => {}); }
      // The proof is the same whoever serves it (the contract checks it): the market maker's proxy first, then the node
      let proof: any = null;
      for (const src of [`${CSD_MM_URL}/api/csd`, CSD_NODE_URL].filter(Boolean)) {
        try { proof = await (await fetch(`${src}/proof/tx/${t.csdTxid}`)).json(); if (proof?.ok) break; } catch {}
      }
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

  // A buy the market maker never settled: once its lock has expired, take your USDC back (you pay the gas)
  async function refund(t: MyTrade) {
    if (!t.authorization) return;
    setBanner(null); setBusy("Confirm the refund in your wallet…");
    try {
      const a = t.authorization;
      const auth = { ...a, csdAmount: BigInt(a.csdAmount), usdcAmount: BigInt(a.usdcAmount), minConfirmations: BigInt(a.minConfirmations), csdMaxTarget: BigInt(a.csdMaxTarget),
        executorFeeAmount: BigInt(a.executorFeeAmount), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) };
      const tx = await writeContractAsync({ address: CSD_SETTLEMENT, abi: csdRefundAbi, functionName: "refundExpiredLock", args: [auth] });
      await publicClient!.waitForTransactionReceipt({ hash: tx });
      saveTrade({ ...t, releaseTx: tx, status: "failed" }); readUsdc();
      setBanner({ kind: "ok", text: `Refunded ${fmtUsdc(BigInt(t.usdcAmount))} USDC.`, links: [{ href: etherscanTx(tx), label: "Transaction" }] });
    } catch (e) { setBanner({ kind: "danger", text: errText(e) }); }
    finally { setBusy(null); }
  }

  async function sendCsd() {
    const to = sendTo.trim().replace(/^0x/, "").toLowerCase(), v = parseCsd(sendAmt);
    if (!/^[0-9a-f]{40}$/.test(to)) { setBanner({ kind: "danger", text: "A CSD address is 40 hexadecimal characters." }); return; }
    if (v <= 0n) { setBanner({ kind: "danger", text: "Enter an amount to send." }); return; }
    setBusy("Sending…");
    try {
      const txid = await csd.send(("0x" + to) as Hex, v);
      setSendTo(""); setSendAmt("");
      setBanner({ kind: "ok", text: `Sent ${fmtCsd(v)} CSD.`, links: csdTxLink(txid) ? [{ href: csdTxLink(txid), label: "CSD transaction" }] : [] });
    } catch (e) { setBanner({ kind: "danger", text: errText(e) }); }
    finally { setBusy(null); }
  }

  const asks = m ? m.asks : [];
  const bids = m ? m.bids : [];
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
  const mid = m?.bestAsk != null && m?.bestBid != null ? (m.bestAsk + m.bestBid) / 2n : m?.bestAsk ?? m?.bestBid ?? null;

  return (
    <main style={{ maxWidth: 1240, margin: "0 auto", padding: "0 24px" }}>
      <section className="hero" style={{ gridTemplateColumns: "1fr", paddingBottom: 12 }}>
        <div>
          <h1 className="hero-title">Trade CSD for USDC.</h1>
          <p className="hero-sub">Straight from your wallet. No account, no deposit.</p>
        </div>
      </section>

      {!CSD_ENABLED && (
        <div className="banner banner-warn"><strong className="warn">Coming soon</strong><span className="muted">The CSD/USDC market isn't live yet.</span></div>
      )}
      {mErr && <div className="banner banner-danger"><strong className="danger">Offline</strong><span className="muted">Retrying…</span></div>}
      {banner && (
        <div className={`banner banner-${banner.kind === "danger" ? "danger" : banner.kind}`} role="status">
          <span>{banner.text}{banner.links?.map(l => <span key={l.href}>{" "}<a href={l.href} target="_blank" rel="noreferrer">{l.label}</a></span>)}</span>
          <button className="link-btn" style={{ marginLeft: "auto" }} onClick={() => setBanner(null)}>Dismiss</button>
        </div>
      )}

      <div className="market-bar">
        <MarketTabs active="CSD-USDC" />
        <div className="market-stats">
          <div><div className="stat-label">Price</div><div className="stat">{mid !== null ? fmtPx(mid) : "—"}</div></div>
          <div><div className="stat-label">Best bid</div><div className="stat buy">{m?.bestBid != null ? fmtPx(m.bestBid) : "—"}</div></div>
          <div><div className="stat-label">Best ask</div><div className="stat sell">{m?.bestAsk != null ? fmtPx(m.bestAsk) : "—"}</div></div>
          <div><div className="stat-label">Market makers</div><div className="stat">{m ? m.makers.length : "—"}</div></div>
        </div>
      </div>

      <div className="exchange-grid">
        <section className="card" aria-label="Order book" style={{ padding: "18px 14px" }}>
          <div className="row-between" style={{ margin: "0 6px 12px" }}>
            <h2 className="panel-title" style={{ fontFamily: "var(--sans)" }}>Order book</h2>
          </div>
          <div className="book-head"><span>Price (USDC)</span><span>Size (CSD)</span><span>Total (USDC)</span></div>
          {!m ? <div className="book-empty">{mErr ? "Unavailable right now." : "Loading the book…"}</div> : (
            <>
              <div className="book-side book-asks">{[...asks].map((l, i) => ({ l, i })).reverse().map(({ l, i }) => row(l, i, "sell", asks))}</div>
              <div className="book-spread">
                <span className="last">{mid !== null ? fmtPx(mid) : "—"}</span>
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
            {preview && best && <div className="faint">Includes a {fmtUsdc(fee)} USDC fee · market maker <a href={aonLink(best.offer.objectHash)} target="_blank" rel="noreferrer" className="mono">{best.maker.slice(0, 6)}…{best.maker.slice(-4)}</a></div>}
            <div className="row-between">
              <span className="muted">Available</span>
              <span>{!isConnected ? "Connect a wallet to see" : side === "buy" ? (usdcBal === null ? "…" : `${fmtUsdc(usdcBal)} USDC`) : csd.ready ? `${fmtCsd(csd.balance)} CSD` : "Open your CSD wallet"}</span>
            </div>
          </div>
          {problem && <div className="form-problem danger" role="alert">{problem}</div>}
          {!isConnected ? (
            <button className="btn btn-lg" onClick={() => connect({ connector: injected() })}>Connect wallet to trade</button>
          ) : (
            <button className={`btn-lg ${side === "buy" ? "btn-buy" : "btn-sell"}`} onClick={side === "buy" ? buy : sell}
              disabled={!!busy || !CSD_ENABLED || wrongChain || (csd.ready && (!preview || !!problem))}>
              {busy ?? (wrongChain ? "Switch to Ethereum" : !csd.ready ? "Open your CSD wallet" : side === "buy" ? "Buy CSD" : "Sell CSD")}
            </button>
          )}
        </section>

        <section className="card trades-card" aria-label="Your wallet" style={{ padding: "18px 18px", alignContent: "start" }}>
          <h2 className="panel-title" style={{ fontFamily: "var(--sans)", marginBottom: 12 }}>Your wallet</h2>
          {!isConnected ? (
            <p className="muted">Connect a wallet to see it.</p>
          ) : !csd.ready ? (
            <div className="col" style={{ gap: 12 }}>
              <p className="muted">Created from your Ethereum wallet, so it's yours on any device.</p>
              <label className="check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /><span>Remember on this device</span></label>
              <button className="btn" onClick={() => csd.setup(remember).catch(e => setBanner({ kind: "danger", text: errText(e) }))} disabled={!!busy}>Open CSD wallet</button>
            </div>
          ) : (
            <div className="col" style={{ gap: 14 }}>
              <div>
                <div className="stat-label">CSD</div>
                <div className="stat" style={{ fontSize: 22 }}>{csd.loaded ? fmtCsd(csd.balance) : "…"}</div>
                {incoming > 0n && <div className="faint">+{fmtCsd(incoming)} CSD arriving</div>}
                {mid !== null && csd.balance > 0n && <div className="faint">≈ {fmtUsdc((csd.balance * mid) / 100_000_000n)} USDC</div>}
              </div>
              <div>
                <div className="stat-label">USDC</div>
                <div className="stat" style={{ fontSize: 22 }}>{usdcBal === null ? "…" : fmtUsdc(usdcBal)}</div>
              </div>
              <div>
                <div className="stat-label">Receive</div>
                <button className="link-btn mono" style={{ fontSize: 13, wordBreak: "break-all", textAlign: "left" }} title="Copy"
                  onClick={() => { navigator.clipboard?.writeText(csd.main!.addr20.slice(2)); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  {csd.main!.addr20.slice(2)}
                </button>
                <div className="faint">{copied ? "Copied" : "Send CSD here to sell it."}</div>
              </div>
              <details>
                <summary className="link-btn" style={{ cursor: "pointer" }}>Send CSD</summary>
                <div className="col" style={{ gap: 8, marginTop: 10 }}>
                  <input value={sendTo} onChange={e => setSendTo(e.target.value)} placeholder="CSD address (40 characters)" autoComplete="off" spellCheck={false} />
                  <div className="field-unit"><input inputMode="decimal" value={sendAmt} onChange={e => setSendAmt(e.target.value.replace(",", "."))} placeholder="0.00" /><span className="unit">CSD</span></div>
                  <button className="btn-secondary" onClick={sendCsd} disabled={!!busy}>Send</button>
                </div>
              </details>
              <p className="faint">Your keys, in this browser. Only you can move it. <Link href="/docs/#csd-wallet">How it works</Link></p>
              <button className="link-btn faint" style={{ justifySelf: "start" }} onClick={csd.forget}>Forget on this device</button>
              {csd.error && <div className="danger" style={{ fontSize: 14 }}>CSD network unreachable</div>}
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
                  <td className="muted">{t.status === "pending" ? "Pending" : new Date(t.at).toLocaleDateString()}</td>
                  <td>{t.side === "buy" && t.status === "pending" && t.authorization && (t.lockedUntil ? Date.now() / 1000 > t.lockedUntil + 60 : Date.now() - t.at > (10 + 5 * Number(t.authorization.minConfirmations) + 2) * 60_000)
                    ? <button className="link-btn" onClick={() => refund(t)} disabled={!!busy} title="The market maker didn't deliver in time. Take your USDC back (costs a little ETH).">Refund</button>
                    : t.side === "sell" && t.status === "pending" && t.csdTxid && Date.now() - t.at > 10 * 60_000
                    ? <button className="link-btn" onClick={() => claim(t)} disabled={!!busy} title="The market maker hasn't released it. Claim the USDC yourself with a proof of your CSD payment (costs a little ETH).">Claim</button>
                    : t.receipt ? <a href={aonLink(t.receipt)} target="_blank" rel="noreferrer">Receipt</a>
                    : (t.releaseTx ?? t.lockTx) && <a href={etherscanTx((t.releaseTx ?? t.lockTx)!)} target="_blank" rel="noreferrer">Tx</a>}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </section>
      </div>
    </main>
  );
}
