"use client";

import { ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  useAccount, useConnect, useDisconnect, useBalance,
  useReadContracts, useWriteContract, usePublicClient, useSignTypedData,
} from "wagmi";
import { injected } from "@wagmi/core";
import { maxUint256, formatUnits, type Address, type Hex } from "viem";
import {
  MARKETS, SETTLEMENT_CONTRACT, CHAIN_ID, DEMO_MODE, TOKENS,
  EXECUTOR_FEE_QUOTE, MAX_FILLS_PER_ORDER, MAX_ORDER_QUOTE,
  MAKER_ORDER_TTL_SECS, MARKET_ORDER_TTL_SECS, NATIVE_GAS_RESERVE,
  AUTH_TYPES, ORDER_TYPES, REVOCATION_TYPES, getEvmSpotDomain,
  SIDE_BUY_BASE, SIDE_SELL_BASE, type Market, type Token,
} from "@/config";
import {
  aonPutObject, fetchNamespaceObjects, deriveState, isLive, commitmentsByMakerToken, matchOrder, applyFunding,
  buildAuthMessage, buildOrderMessage, authForSigning, orderForSigning,
  authObject, orderObject, fillObject, revocationMessage, revocationObject,
  toBaseUnits, toPrice, quoteFor, fmtBase, fmtQuote, fmtPrice, fmt, priceNumber, priceToInput,
  shortHash, shortAddr, formatCountdown,
} from "@/aon";
import { erc20Abi, wethAbi, evmSpotSettlementAbi } from "@/abi";
import type { AonObject, RestingOrder, FillView, Log, Side } from "@/types";
import { finalizeObject } from "@intervalplace/aon-sdk";
import { Arc } from "@/arc";
import { getReference, deviation, type Reference } from "@/reference";

const finalize = (o: any) => finalizeObject(o as any) as any as AonObject;
const EXPLORER = "https://explorer.aon.network";
const etherscanTx = (tx: string) => (CHAIN_ID === 1 ? `https://etherscan.io/tx/${tx}` : `${EXPLORER}`);
const BOOK_DEPTH = 10;

function tryParse<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}
const minBig = (a: bigint, b: bigint) => (a < b ? a : b);

type Level = { price: bigint; size: bigint; total: bigint; cum: bigint; mine: boolean };

export default function Home() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected, chainId } = useAccount();
  const { connect }    = useConnect();
  const { disconnect } = useDisconnect();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  // ── UI state ────────────────────────────────────────────────────────────────
  const [marketKey, setMarketKey] = useState(MARKETS[0].key);
  const market = MARKETS.find(m => m.key === marketKey) ?? MARKETS[0];

  const [logs, setLogs]       = useState<Log[]>([]);
  const [status, setStatus]   = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const addLog = (text: string) => setLogs(l => [{ ts: Date.now(), text }, ...l].slice(0, 40));

  const [side, setSide]           = useState<Side>("buy");
  const [orderType, setOrderType] = useState<"limit" | "market">("limit");
  const [priceHuman,  setPriceHuman]  = useState("");
  const [amountHuman, setAmountHuman] = useState("");
  const [activityTab, setActivityTab] = useState<"open" | "trades">("open");

  // Chainlink reference price for the active market
  const [reference, setReference] = useState<Reference | null>(null);
  useEffect(() => {
    let alive = true;
    setReference(null);
    if (!publicClient) return;
    const load = () => getReference(publicClient as any, market).then(r => { if (alive) setReference(r); }).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [market.key, publicClient]);
  const refPrice = reference && !reference.stale ? reference.price : null;

  // Confirmation for orders far from the market price
  const [offMarketOk, setOffMarketOk] = useState(false);

  // Active traders can keep WETH to avoid re-wrapping on every sell
  const [preferWeth, setPreferWeth] = useState(false);
  useEffect(() => { try { setPreferWeth(localStorage.getItem("covenant.receive.weth") === "1"); } catch {} }, []);
  const togglePreferWeth = (v: boolean) => { setPreferWeth(v); try { localStorage.setItem("covenant.receive.weth", v ? "1" : "0"); } catch {} };

  // First-visit guide
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => {
    try { setGuideOpen(localStorage.getItem("covenant.guide.hidden") !== "1"); } catch { setGuideOpen(true); }
  }, []);
  const hideGuide = () => { setGuideOpen(false); try { localStorage.setItem("covenant.guide.hidden", "1"); } catch {} };

  const [orders, setOrders] = useState<RestingOrder[]>([]);
  const [fills,  setFills]  = useState<FillView[]>([]);
  const [nodeUnreachable, setNodeUnreachable] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [nowSecs, setNowSecs] = useState(Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNowSecs(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { setPriceHuman(""); setAmountHuman(""); setStatus(""); }, [marketKey]);

  // ── Wallet reads for the active market ──────────────────────────────────────
  const readsEnabled = !!address && !!SETTLEMENT_CONTRACT && !DEMO_MODE;
  const owner = (address ?? "0x0000000000000000000000000000000000000000") as Address;
  const { data: reads, refetch: refetchReads } = useReadContracts({
    contracts: [
      { address: market.base.address,  abi: erc20Abi, functionName: "balanceOf", args: [owner] },
      { address: market.base.address,  abi: erc20Abi, functionName: "allowance", args: [owner, SETTLEMENT_CONTRACT] },
      { address: market.quote.address, abi: erc20Abi, functionName: "balanceOf", args: [owner] },
      { address: market.quote.address, abi: erc20Abi, functionName: "allowance", args: [owner, SETTLEMENT_CONTRACT] },
    ],
    query: { enabled: readsEnabled, refetchInterval: 4000 },
  });
  const { data: nativeBal, refetch: refetchNative } = useBalance({ address, query: { enabled: !!address && !DEMO_MODE, refetchInterval: 8000 } });

  // Native ETH payout goes to plain wallets. Addresses with code (smart
  // accounts, EIP-7702 delegations) might refuse ETH, so they get WETH.
  const [canReceiveNative, setCanReceiveNative] = useState(true);
  useEffect(() => {
    if (!address || !publicClient || DEMO_MODE) { setCanReceiveNative(true); return; }
    publicClient.getCode({ address }).then(c => setCanReceiveNative(!c || c === "0x")).catch(() => setCanReceiveNative(false));
  }, [address, publicClient]);

  const demo = (d: number) => 10_000n * 10n ** BigInt(d);
  // Demo wallet: plain ETH and no WETH on ETH/USDT, so the wrap step shows up
  const baseBalance    = !isConnected ? 0n : DEMO_MODE ? (market.base.wrapsNative ? 0n : demo(market.base.decimals)) : (readsEnabled ? (reads?.[0]?.result ?? 0n) : 0n);
  const baseAllowance  = DEMO_MODE ? maxUint256 : (readsEnabled ? (reads?.[1]?.result ?? 0n) : 0n);
  const quoteBalance   = !isConnected ? 0n : DEMO_MODE ? demo(market.quote.decimals) : (readsEnabled ? (reads?.[2]?.result ?? 0n) : 0n);
  const quoteAllowance = DEMO_MODE ? maxUint256 : (readsEnabled ? (reads?.[3]?.result ?? 0n) : 0n);
  const nativeBalance  = !isConnected ? 0n : DEMO_MODE ? 5n * 10n ** 18n : (nativeBal?.value ?? 0n);

  // ── AON + chain refresh ─────────────────────────────────────────────────────
  const refreshing = useRef(false);
  const refreshAgain = useRef(false);
  const usedNonceCache = useRef(new Set<string>()); // consumed nonces never un-consume

  const refresh = useCallback(async () => {
    if (refreshing.current) { refreshAgain.current = true; return; }
    refreshing.current = true;
    try {
      const objects = await fetchNamespaceObjects();
      let state = await deriveState(objects);
      const pc = publicClient;

      if (pc && SETTLEMENT_CONTRACT && !DEMO_MODE) {
        const read = (functionName: "usedFillNonce" | "filledBaseByOrder", arg: Hex) =>
          pc.readContract({ address: SETTLEMENT_CONTRACT, abi: evmSpotSettlementAbi, functionName, args: [arg] } as any);

        // 1. Which fills has the contract actually settled? (source of truth)
        const weekAgo = Date.now() - 7 * 86400e3;
        const unknown = state.fills.filter(f => f.createdAt > weekAgo && !usedNonceCache.current.has(f.fillNonce.toLowerCase()));
        await Promise.all(unknown.map(async f => {
          if (await read("usedFillNonce", f.fillNonce).catch(() => false)) usedNonceCache.current.add(f.fillNonce.toLowerCase());
        }));

        // 2. Per-order fill totals (also catches fills settled outside AON)
        const candidates = state.orders.filter(o => !o.cancelled && !o.expired);
        const filled = new Map<string, bigint>();
        await Promise.all(candidates.map(async o => {
          const v = await read("filledBaseByOrder", o.orderEip712).catch(() => 0n) as bigint;
          if (v > 0n) filled.set(o.orderEip712.toLowerCase(), v);
        }));
        state = await deriveState(objects, { filled, usedNonces: usedNonceCache.current });

        // 3. Hide liquidity the maker can't currently pay for
        const live = state.orders.filter(isLive);
        const keys = [...new Set(live.map(o => `${o.maker.toLowerCase()}:${(o.side === "sell" ? o.market.base : o.market.quote).address.toLowerCase()}`))];
        const capacity = new Map<string, bigint>();
        await Promise.all(keys.map(async k => {
          const [maker, token] = k.split(":") as [Address, Address];
          const [bal, allow] = await Promise.all([
            pc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [maker] }).catch(() => 0n),
            pc.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [maker, SETTLEMENT_CONTRACT] }).catch(() => 0n),
          ]) as [bigint, bigint];
          capacity.set(k, minBig(bal, allow));
        }));
        applyFunding(state.orders, capacity);
      }

      setOrders(state.orders);
      setFills(state.fills);
      setNodeUnreachable(false);
    } catch (err) {
      console.error("refresh error", err);
      setNodeUnreachable(true);
    } finally {
      refreshing.current = false;
      setInitialLoadDone(true);
      if (refreshAgain.current) { refreshAgain.current = false; setTimeout(() => refresh(), 0); }
    }
  }, [publicClient]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  // ── Derived views ───────────────────────────────────────────────────────────
  const me = address?.toLowerCase();
  const B = market.base.symbol;
  const Q = market.quote.symbol;

  const bookOrders = orders.filter(o => o.market.key === market.key && isLive(o) && o.funded);
  const levels = (s: Side): Level[] => {
    const map = new Map<bigint, Level>();
    for (const o of bookOrders.filter(o => o.side === s)) {
      const l = map.get(o.price) ?? { price: o.price, size: 0n, total: 0n, cum: 0n, mine: false };
      l.size += o.remaining; l.total += quoteFor(o.remaining, o.price);
      l.mine ||= o.maker.toLowerCase() === me;
      map.set(o.price, l);
    }
    const sorted = [...map.values()].sort((a, b) =>
      s === "sell" ? (a.price < b.price ? -1 : 1) : (a.price > b.price ? -1 : 1)).slice(0, BOOK_DEPTH);
    let cum = 0n;
    for (const l of sorted) { cum += l.size; l.cum = cum; }
    return sorted;
  };
  const asks = levels("sell");
  const bids = levels("buy");
  const maxCum = [asks.at(-1)?.cum ?? 0n, bids.at(-1)?.cum ?? 0n].reduce((a, b) => (a > b ? a : b), 1n);

  const marketFills = useMemo(() => fills.filter(f => f.market.key === market.key && f.status !== "stale"), [fills, market.key]);
  const settledTrades = marketFills.filter(f => f.status === "settled");
  const lastPrice = settledTrades[0]?.price;

  const myOpen = me ? orders.filter(o => o.maker.toLowerCase() === me && !o.cancelled && !o.expired && (o.remaining > 0n || o.pending > 0n)) : [];
  const myFills = me ? fills.filter(f => f.maker.toLowerCase() === me || f.taker.toLowerCase() === me).slice(0, 25) : [];

  // Tokens already promised to my other open orders
  const commitments = useMemo(() => commitmentsByMakerToken(orders), [orders]);
  const committed = (t: Token) => (me ? commitments.get(`${me}:${t.address.toLowerCase()}`) ?? 0n : 0n);
  const baseAvail  = baseBalance  > committed(market.base)  ? baseBalance  - committed(market.base)  : 0n;
  const quoteAvail = quoteBalance > committed(market.quote) ? quoteBalance - committed(market.quote) : 0n;
  // On ETH markets, ETH in the wallet can be wrapped on the way into a sell
  const isEthMarket = !!market.base.wrapsNative;
  const wrappable = isEthMarket && nativeBalance > NATIVE_GAS_RESERVE ? nativeBalance - NATIVE_GAS_RESERVE : 0n;
  const sellAvail = baseAvail + wrappable;

  // ── Order preview ───────────────────────────────────────────────────────────
  const amount = tryParse(() => toBaseUnits(market, amountHuman));
  const limit  = orderType === "limit" ? tryParse(() => toPrice(market, priceHuman)) : null;
  const preview = useMemo(() => {
    if (!amount || amount === 0n || (orderType === "limit" && !limit)) return null;
    const m = matchOrder({ book: orders, market, side, amount, limit, me });
    const orderPrice = orderType === "limit" ? limit! : m.worstPrice;
    const orderBase  = orderType === "limit" ? amount : m.filled;
    const fee = side === "buy" ? EXECUTOR_FEE_QUOTE * BigInt(m.legs.length) : 0n;
    const maxFeeBudget = side === "buy" ? EXECUTOR_FEE_QUOTE * MAX_FILLS_PER_ORDER : 0n;
    const cost = orderPrice ? quoteFor(orderBase, orderPrice) : 0n; // worst case for a buy
    const need = side === "buy" ? cost + maxFeeBudget : orderBase;
    return { ...m, orderPrice, orderBase, fee, maxFeeBudget, cost, need };
  }, [amount, limit, orderType, side, orders, market, me]);

  const payToken  = side === "buy" ? market.quote : market.base;
  const payAvail  = side === "buy" ? quoteAvail : sellAvail;
  // WETH to create from ETH before this sell can be signed
  const wrapNeeded = side === "sell" && isEthMarket && preview && preview.orderBase > baseAvail ? preview.orderBase - baseAvail : 0n;
  const receiveNative = side === "buy" && isEthMarket && canReceiveNative && !preferWeth;
  const payAllow  = side === "buy" ? quoteAllowance : baseAllowance;

  const problem = (() => {
    if (!preview) return null;
    if (preview.selfCross) return "This would trade against your own order. Cancel it first or change the price.";
    if (orderType === "market" && preview.filled === 0n) return `No ${side === "buy" ? "sell" : "buy"} orders to match.`;
    if (orderType === "market" && preview.filled < (amount ?? 0n)) return `Only ${fmtBase(market, preview.filled)} ${B} available. The order will be reduced.`;
    if (MAX_ORDER_QUOTE > 0n && preview.orderPrice && quoteFor(preview.orderBase, preview.orderPrice) > MAX_ORDER_QUOTE)
      return `Orders are limited to ${fmtQuote(market, MAX_ORDER_QUOTE)} ${Q} for now.`;
    if (isConnected && payAvail < preview.need) return `Not enough ${payToken.symbol}. Available: ${fmt(payAvail, payToken.decimals)}.`;
    return null;
  })();
  // How far this order's price is from the market, in the direction that costs you.
  // What counts: the average price of what fills now, and — for a limit order —
  // the limit price of any part left waiting in the book, since anyone can
  // trade against that at exactly that price.
  const offMarket = (() => {
    if (!preview || refPrice === null || preview.selfCross) return null;
    const ref = refPrice.toLocaleString(undefined, { maximumFractionDigits: 2 });
    const worse = (px: number) => (side === "buy" ? 1 : -1) * deviation(px, refPrice); // + = worse than market
    const fmtPct = (d: number) => (d * 100).toFixed(d < 0.1 ? 1 : 0);
    const dir = side === "buy" ? "above" : "below";

    const rests = orderType === "limit" && preview.remainder > 0n && limit;
    const dRest = rests ? worse(priceNumber(market, limit!)) : -1;
    const dFill = preview.filled > 0n && preview.avgPrice ? worse(priceNumber(market, preview.avgPrice)) : -1;

    let text: string | null = null, d = -1;
    if (dRest >= 0.02 && dRest >= dFill) {
      d = dRest;
      text = preview.filled > 0n
        ? `The part that doesn't fill right away would wait in the book at ${fmtPct(d)}% ${dir} the market price of ${ref} ${Q}, where anyone can take it.`
        : `Your price is ${fmtPct(d)}% ${dir} the market price of ${ref} ${Q}. Anyone can take this order at that price.`;
    } else if (dFill >= 0.02) {
      d = dFill;
      text = `This fills at an average ${fmtPct(d)}% ${dir} the market price of ${ref} ${Q}. The book is thin at these prices.`;
    }
    return text ? { text, severe: d >= 0.10 } : null;
  })();
  useEffect(() => { setOffMarketOk(false); }, [priceHuman, amountHuman, side, orderType, marketKey]);

  const blocking = (problem && !problem.startsWith("Only ")) || (offMarket?.severe && !offMarketOk);

  function setPct(pct: bigint) {
    if (side === "sell") { setAmountHuman(formatUnits(sellAvail * pct / 100n, market.base.decimals)); return; }
    const p = orderType === "limit" ? limit : asks[0]?.price;
    if (!p || p === 0n) return;
    const spend = quoteAvail * pct / 100n - EXECUTOR_FEE_QUOTE * MAX_FILLS_PER_ORDER;
    if (spend <= 0n) return;
    setAmountHuman(formatUnits((spend * 10n ** 18n) / p, market.base.decimals));
  }

  function pickLevel(l: Level, levelSide: Side) {
    setOrderType("limit");
    setSide(levelSide === "sell" ? "buy" : "sell");
    setPriceHuman(priceToInput(market, l.price));
    setAmountHuman(formatUnits(l.cum, market.base.decimals));
  }

  // ── Wallet helpers ──────────────────────────────────────────────────────────
  function requireReady(): Address | null {
    if (!address) { setStatus("Connect a wallet to trade."); return null; }
    if (chainId !== CHAIN_ID) { setStatus("Switch your wallet to Ethereum mainnet."); return null; }
    if (!SETTLEMENT_CONTRACT) { setStatus("Settlement contract is not configured (NEXT_PUBLIC_EVM_SPOT_SETTLEMENT)."); return null; }
    return address;
  }

  async function ensureAllowance(token: Token, needed: bigint) {
    if (DEMO_MODE || !address || !publicClient || needed === 0n) return;
    const current = await publicClient.readContract({
      address: token.address, abi: erc20Abi, functionName: "allowance", args: [address, SETTLEMENT_CONTRACT],
    }) as bigint;
    if (current >= needed) return;
    // USDT rejects changing a nonzero allowance to another nonzero value
    if (current > 0n && token.address.toLowerCase() === TOKENS.USDT.address.toLowerCase()) {
      setLoading(`Resetting ${token.symbol} approval...`);
      const tx0 = await writeContractAsync({ address: token.address, abi: erc20Abi, functionName: "approve", args: [SETTLEMENT_CONTRACT, 0n] });
      await publicClient.waitForTransactionReceipt({ hash: tx0 });
    }
    setLoading(`Approve ${token.symbol} in your wallet...`);
    const tx = await writeContractAsync({ address: token.address, abi: erc20Abi, functionName: "approve", args: [SETTLEMENT_CONTRACT, maxUint256] });
    setLoading(`Waiting for ${token.symbol} approval...`);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    addLog(`${token.symbol} approved for the settlement contract.`);
    refetchReads();
  }

  function errorText(err: any) {
    const msg = err?.shortMessage ?? err?.message ?? "Unknown error";
    if (/reject|denied/i.test(msg)) return "Request cancelled in wallet.";
    return msg.slice(0, 160);
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function submitOrder() {
    const trader = requireReady();
    if (!trader || !preview || blocking || !preview.orderPrice || preview.orderBase === 0n) return;
    // Re-match against the latest book right before signing
    const m = matchOrder({ book: orders, market, side, amount: amount!, limit, me });
    if (m.selfCross) { setStatus("This would trade against your own order."); return; }
    const price = orderType === "limit" ? limit! : m.worstPrice!;
    const base  = orderType === "limit" ? amount! : m.filled;
    if (base === 0n) { setStatus("Nothing to match."); return; }

    const sideNum = side === "buy" ? SIDE_BUY_BASE : SIDE_SELL_BASE;
    const maxFee  = side === "buy" ? EXECUTOR_FEE_QUOTE * MAX_FILLS_PER_ORDER : 0n;
    const need    = side === "buy" ? quoteFor(base, price) + maxFee : base;

    try {
      // Selling ETH: wrap whatever the wallet's WETH doesn't cover
      const shortfall = side === "sell" && isEthMarket && base > baseAvail ? base - baseAvail : 0n;
      if (shortfall > 0n && !DEMO_MODE && publicClient) {
        if (shortfall > wrappable) { setStatus(`Not enough ETH. Keep at least ${fmt(NATIVE_GAS_RESERVE, 18)} ETH for gas.`); return; }
        setLoading(`Wrap ${fmtBase(market, shortfall)} ETH in your wallet...`);
        const wtx = await writeContractAsync({ address: market.base.address, abi: wethAbi, functionName: "deposit", value: shortfall });
        setLoading("Wrapping ETH...");
        await publicClient.waitForTransactionReceipt({ hash: wtx });
        addLog(`Wrapped ${fmtBase(market, shortfall)} ETH for this sell.`);
        refetchReads(); refetchNative();
      }

      await ensureAllowance(payToken, need);

      const auth = buildAuthMessage({
        market, grantor: trader, side: sideNum, baseAmount: base, limitPrice: price, maxFee,
        ttlSecs: orderType === "limit" ? MAKER_ORDER_TTL_SECS : MARKET_ORDER_TTL_SECS,
      });
      setLoading("Sign 1 of 2: authorization...");
      const authSig = await signTypedDataAsync({
        domain: getEvmSpotDomain(), types: AUTH_TYPES, primaryType: "TradingSessionAuthorization",
        message: authForSigning(auth) as any,
      });
      const authObj = authObject(finalize, auth, authSig as Hex);

      const order = buildOrderMessage({ market, trader, side: sideNum, price, baseAmount: base, auth, receiveNative });
      setLoading("Sign 2 of 2: order...");
      const orderSig = await signTypedDataAsync({
        domain: getEvmSpotDomain(), types: ORDER_TYPES, primaryType: "SignedOrder",
        message: orderForSigning(order) as any,
      });
      const orderObj = orderObject(finalize, authObj.objectHash, order, orderSig as Hex);

      setLoading("Publishing to AON...");
      await aonPutObject(authObj);
      await aonPutObject(orderObj);
      addLog(`Order ${shortHash(orderObj.objectHash)}: ${side} ${fmtBase(market, base)} ${B} @ ${fmtPrice(market, price)}`);

      // Fills against the book, at each resting order's price
      const feeUsed = new Map<string, bigint>();
      for (const leg of m.legs) {
        let fee = EXECUTOR_FEE_QUOTE;
        if (side === "sell") { // resting buyer pays, within their remaining fee budget
          const k = leg.order.orderObj.objectHash;
          const left = leg.order.feeBudgetLeft - (feeUsed.get(k) ?? 0n);
          fee = minBig(fee, left > 0n ? left : 0n);
          feeUsed.set(k, (feeUsed.get(k) ?? 0n) + fee);
        }
        const f = fillObject(finalize, {
          makerAuthHash: leg.order.authObj.objectHash, takerAuthHash: authObj.objectHash,
          makerOrderHash: leg.order.orderObj.objectHash, takerOrderHash: orderObj.objectHash,
          price: leg.price, baseAmount: leg.base, executorFee: fee,
        });
        await aonPutObject(f);
        addLog(`Fill ${fmtBase(market, leg.base)} ${B} @ ${fmtPrice(market, leg.price)}`);
      }

      const parts: string[] = [];
      if (m.filled > 0n) parts.push(`${side === "buy" ? "Bought" : "Sold"} ${fmtBase(market, m.filled)} ${B}, settling on Ethereum`);
      if (orderType === "limit" && m.remainder > 0n) parts.push(`${fmtBase(market, m.remainder)} ${B} resting at ${fmtPrice(market, price)}`);
      setStatus(parts.join(". ") + ".");
      setAmountHuman("");
      await refresh();
    } catch (err) {
      setStatus(errorText(err));
    } finally { setLoading(null); }
  }

  // Free cancel: a signed revocation on AON. Executors and every Covenant
  // interface stop matching the order immediately.
  // On-chain cancel additionally revokes the authorization in the contract,
  // so nobody can settle the order even by calling the contract directly.
  async function cancelOrder(o: RestingOrder, onChain = false) {
    if (!requireReady()) return;
    try {
      const msg = revocationMessage(o.authObj);
      setLoading("Sign cancellation...");
      const sig = await signTypedDataAsync({
        domain: getEvmSpotDomain(), types: REVOCATION_TYPES, primaryType: "AonRevocation", message: msg,
      });
      await aonPutObject(revocationObject(finalize, o.authObj, msg, sig as Hex));
      addLog(`Cancelled ${shortHash(o.orderObj.objectHash)}`);

      if (onChain && publicClient && !DEMO_MODE) {
        setLoading("Confirm on-chain cancel in wallet...");
        const a = o.authObj.payload.authorization;
        const tx = await writeContractAsync({
          address: SETTLEMENT_CONTRACT, abi: evmSpotSettlementAbi, functionName: "revokeAuthorization",
          args: [{
            grantor: a.grantor, settlementContract: a.settlementContract, baseToken: a.baseToken, quoteToken: a.quoteToken,
            marketId: a.marketId, sideMask: Number(a.sideMask),
            maxBaseExposure: BigInt(a.maxBaseExposure), maxQuoteExposure: BigInt(a.maxQuoteExposure),
            maxExecutorFeeQuote: BigInt(a.maxExecutorFeeQuote), minPrice: BigInt(a.minPrice), maxPrice: BigInt(a.maxPrice),
            validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), authNonce: a.authNonce,
          }],
        });
        setLoading("Waiting for on-chain cancel...");
        await publicClient.waitForTransactionReceipt({ hash: tx });
        addLog(`Revoked on-chain: ${shortHash(tx)}`);
        setStatus("Order cancelled on AON and in the settlement contract.");
      } else {
        setStatus("Order cancelled.");
      }
      await refresh();
    } catch (err) {
      setStatus(errorText(err));
    } finally { setLoading(null); }
  }

  // Loose WETH (not backing any order) back to ETH
  async function unwrapWeth(amount: bigint) {
    if (!requireReady() || !publicClient || amount === 0n) return;
    try {
      setLoading("Confirm in your wallet...");
      const tx = await writeContractAsync({ address: TOKENS.WETH.address, abi: wethAbi, functionName: "withdraw", args: [amount] });
      setLoading("Converting to ETH...");
      await publicClient.waitForTransactionReceipt({ hash: tx });
      addLog(`Converted ${fmt(amount, 18)} WETH to ETH.`);
      setStatus(`Converted ${fmt(amount, 18)} WETH to ETH.`);
      refetchReads(); refetchNative();
    } catch (err) {
      setStatus(errorText(err));
    } finally { setLoading(null); }
  }

  if (!mounted) return null;

  const isWrongChain = isConnected && chainId !== CHAIN_ID;
  const spread = asks[0] && bids[0] ? asks[0].price - bids[0].price : null;

  // ── The covenant: the order, in the words you're agreeing to ────────────────
  const clause = (() => {
    if (!preview || preview.selfCross || !preview.orderPrice || preview.orderBase === 0n) return null;
    const expiry = new Date((nowSecs + (orderType === "limit" ? MAKER_ORDER_TTL_SECS : MARKET_ORDER_TTL_SECS)) * 1000)
      .toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
    const amt = `${fmtBase(market, preview.orderBase)} ${B}`;
    const px  = `${fmtPrice(market, preview.orderPrice)} ${Q}`;
    const sentences: string[] = [];
    if (orderType === "limit") {
      sentences.push(side === "buy"
        ? `I will buy up to ${amt} at no more than ${px} each, spending at most ${fmtQuote(market, preview.cost)} ${Q}.`
        : `I will sell up to ${amt} at no less than ${px} each, receiving at least ${fmtQuote(market, preview.cost)} ${Q}.`);
      if (preview.filled > 0n)
        sentences.push(`${fmtBase(market, preview.filled)} ${B} fills right away at an average of ${fmt(preview.avgPrice!, market.quote.decimals + 18 - market.base.decimals, 2)} ${Q}.`);
      if (preview.remainder > 0n)
        sentences.push(`${preview.filled > 0n ? "The rest" : "The order"} waits in the book until ${expiry}, or until I cancel it.`);
    } else {
      sentences.push(side === "buy"
        ? `I will buy ${amt} from the best offers in the book, paying no more than ${px} each and ${fmtQuote(market, preview.quote)} ${Q} in total.`
        : `I will sell ${amt} to the best bids in the book, at no less than ${px} each, for ${fmtQuote(market, preview.quote)} ${Q} in total.`);
      sentences.push("Nothing is left waiting in the book.");
    }
    if (preview.fee > 0n) sentences.push(`I pay the executor ${fmtQuote(market, preview.fee)} ${Q}.`);
    if (wrapNeeded > 0n) sentences.unshift(`First I wrap ${fmtBase(market, wrapNeeded)} ETH so it can be traded.`);
    if (side === "buy" && isEthMarket && !receiveNative) sentences.push("I receive it as WETH, ready to sell again without wrapping.");
    return sentences.join(" ");
  })();

  const levelRow = (l: Level, s: Side) => {
    const pct = Number((l.cum * 1000n) / maxCum) / 10;
    return (
      <button key={`${s}-${l.price}`} className="book-row" onClick={() => pickLevel(l, s)}
        style={{ ["--depth" as any]: `${pct}%` }} data-side={s}
        title={s === "sell" ? `Buy up to ${fmtBase(market, l.cum)} ${B} at ${fmtPrice(market, l.price)} or better` : `Sell up to ${fmtBase(market, l.cum)} ${B} at ${fmtPrice(market, l.price)} or better`}>
        <span className={s}>{fmtPrice(market, l.price)}{l.mine && <span className="mine-dot" title="Includes your order" />}</span>
        <span>{fmtBase(market, l.size)}</span>
        <span className="muted">{fmtQuote(market, l.total)}</span>
      </button>
    );
  };

  const timeline = (f: FillView) => (
    <span className="timeline" aria-label={f.status === "settled" ? "Settled" : f.status === "pending" ? "Settling" : "Not settled"}>
      <span className="step done">Signed</span>
      <span className="bar done" />
      <span className="step done">Matched</span>
      <span className={`bar ${f.status === "settled" ? "done" : ""}`} />
      <span className={`step ${f.status === "settled" ? "done" : f.status === "pending" ? "now" : "fail"}`}>
        {f.status === "settled" ? "Settled" : f.status === "pending" ? "Settling" : "Not settled"}
      </span>
    </span>
  );

  return (
    <main style={{ maxWidth: 1240, margin: "0 auto", padding: "0 24px" }}>

      {/* Hero */}
      <section className="hero" style={guideOpen ? undefined : { gridTemplateColumns: "1fr" }}>
        <div>
          <div className="hero-arc"><Arc width={500} sagitta={17} thickness={1.5} draw style={{ width: "100%", height: "auto" }} /></div>
          <h1 className="hero-title">Execution no longer requires trust.</h1>
          <p className="hero-sub">
            Trade ETH, LINK and QNT for USDT from your own wallet. Nobody holds your
            funds. They move only when your exact terms are met, in a single
            Ethereum transaction.
          </p>
        </div>
        {guideOpen && (
          <aside className="steps" aria-label="How trading works">
            <div className="row-between">
              <span className="panel-title">New here? It takes three steps.</span>
              <button className="link-btn muted" onClick={hideGuide}>Hide</button>
            </div>
            <ol>
              <li><div><strong>Connect a wallet</strong><span>Any Ethereum wallet. Your funds stay in it.</span></div></li>
              <li><div><strong>Sign your order</strong><span>Free, no gas. Your tokens stay in your wallet while it waits.</span></div></li>
              <li><div><strong>It settles on Ethereum</strong><span>Both sides swap in one transaction, or nothing moves.</span></div></li>
            </ol>
          </aside>
        )}
      </section>

      {DEMO_MODE && (
        <div className="banner banner-warn">
          <strong className="warn">Demo mode</strong>
          <span className="muted">Balances and approvals are simulated. Orders are still published to AON.</span>
        </div>
      )}
      {!SETTLEMENT_CONTRACT && (
        <div className="banner banner-danger">
          <strong className="danger">Trading isn't set up yet</strong>
          <span className="muted">Set NEXT_PUBLIC_EVM_SPOT_SETTLEMENT to the deployed settlement contract.</span>
        </div>
      )}
      {nodeUnreachable && (
        <div className="banner banner-danger">
          <strong className="danger">Can't reach the AON network</strong>
          <span className="muted">The order book may be out of date. Retrying automatically.</span>
        </div>
      )}
      {status && (
        <div className="banner banner-info" role="status">
          <span>{status}</span>
          <button className="link-btn" style={{ marginLeft: "auto" }} onClick={() => setStatus("")}>Dismiss</button>
        </div>
      )}

      {/* Market bar */}
      <div className="market-bar">
        <div className="market-tabs" role="tablist" aria-label="Market">
          {MARKETS.map(m => (
            <button key={m.key} role="tab" aria-selected={m.key === market.key}
              className={m.key === market.key ? "tab tab-on" : "tab"} onClick={() => setMarketKey(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="market-stats">
          <div title={reference ? `Chainlink ${B}/USD${reference.quoteIsUsd ? "" : `, converted to ${Q}`}. Updated ${new Date(reference.updatedAt).toLocaleTimeString()}.` : `No Chainlink feed for ${B}`}>
            <div className="stat-label">Market price</div>
            <div className="stat">{refPrice !== null ? refPrice.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</div>
          </div>
          <div><div className="stat-label">Last trade</div><div className="stat">{lastPrice !== undefined ? fmtPrice(market, lastPrice) : "—"}</div></div>
          <div><div className="stat-label">Best bid</div><div className="stat buy">{bids[0] ? fmtPrice(market, bids[0].price) : "—"}</div></div>
          <div><div className="stat-label">Best ask</div><div className="stat sell">{asks[0] ? fmtPrice(market, asks[0].price) : "—"}</div></div>
          <div><div className="stat-label">Trades</div><div className="stat">{settledTrades.length}</div></div>
        </div>
      </div>
      {market.note && <p className="market-note">{market.note}</p>}

      <div className="exchange-grid">

        {/* Order book */}
        <section className="card" aria-label="Order book" style={{ padding: "18px 14px" }}>
          <div className="row-between" style={{ margin: "0 6px 12px" }}>
            <h2 className="panel-title" style={{ fontFamily: "var(--sans)" }}>Order book</h2>
            <span className="faint">Tap a price to trade it</span>
          </div>
          <div className="book-head">
            <span>Price ({Q})</span><span>Size ({B})</span><span>Total ({Q})</span>
          </div>
          {!initialLoadDone ? (
            <div className="book-empty">Loading the book…</div>
          ) : (
            <>
              <div className="book-side book-asks">
                {asks.length === 0
                  ? <div className="book-empty">No one is selling {B} yet. A sell order you place will be first in line.</div>
                  : [...asks].reverse().map(l => levelRow(l, "sell"))}
              </div>
              <div className="book-spread">
                <span className="last">{lastPrice !== undefined ? fmtPrice(market, lastPrice) : "—"}</span>
                <span className="faint">{spread !== null ? `Spread ${fmtPrice(market, spread > 0n ? spread : 0n)}` : "Last price"}</span>
              </div>
              <div className="book-side">
                {bids.length === 0
                  ? <div className="book-empty">No one is buying {B} yet. A buy order you place will be first in line.</div>
                  : bids.map(l => levelRow(l, "buy"))}
              </div>
            </>
          )}
        </section>

        {/* Order form */}
        <section className="card order-card grid" aria-label="Place an order" style={{ alignContent: "start", gap: 16 }}>
          <div className="seg-side" role="radiogroup" aria-label="Buy or sell">
            <button role="radio" aria-checked={side === "buy"}  className={side === "buy"  ? "side-buy on"  : "side-buy"}  onClick={() => setSide("buy")}>Buy {B}</button>
            <button role="radio" aria-checked={side === "sell"} className={side === "sell" ? "side-sell on" : "side-sell"} onClick={() => setSide("sell")}>Sell {B}</button>
          </div>
          <div className="type-toggle" role="radiogroup" aria-label="Order type">
            {(["limit", "market"] as const).map(t => (
              <button key={t} role="radio" aria-checked={orderType === t} className={orderType === t ? "on" : ""} onClick={() => setOrderType(t)}
                title={t === "limit" ? "Choose your price. Anything that doesn't fill waits in the book." : "Fill now at the best prices available."}>
                {t === "limit" ? "Limit" : "Market"}
              </button>
            ))}
          </div>

          {orderType === "limit" ? (
            <div>
              <label htmlFor="price">{side === "buy" ? "Highest price you'll pay" : "Lowest price you'll accept"}</label>
              <div className="field-unit">
                <input id="price" inputMode="decimal" autoComplete="off" value={priceHuman} onChange={e => setPriceHuman(e.target.value)}
                  placeholder={(side === "buy" ? asks[0] ?? bids[0] : bids[0] ?? asks[0]) ? priceToInput(market, (side === "buy" ? asks[0] ?? bids[0] : bids[0] ?? asks[0])!.price) : "0.00"} />
                <span className="unit">{Q}</span>
              </div>
            </div>
          ) : (
            <div>
              <label>Price</label>
              <div className="input-like">Best available in the book</div>
            </div>
          )}

          <div>
            <label htmlFor="amount">Amount</label>
            <div className="field-unit">
              <input id="amount" inputMode="decimal" autoComplete="off" value={amountHuman} onChange={e => setAmountHuman(e.target.value)} placeholder="0.00" />
              <span className="unit">{B}</span>
            </div>
            {isConnected && (
              <div className="pct-row" aria-label="Use part of your balance">
                {[25n, 50n, 75n, 100n].map(p => (
                  <button key={String(p)} className="pct" onClick={() => setPct(p)}>{p === 100n ? "Max" : `${String(p)}%`}</button>
                ))}
              </div>
            )}
          </div>

          {side === "buy" && isEthMarket && canReceiveNative && (
            <label className="check">
              <input type="checkbox" checked={preferWeth} onChange={e => togglePreferWeth(e.target.checked)} />
              <span>Receive as WETH<span className="faint check-note">For frequent traders: selling later needs no wrapping.</span></span>
            </label>
          )}

          <div className="summary">
            <div className="row-between">
              <span className="muted">Available</span>
              <span>{isConnected ? `${fmt(payAvail, payToken.decimals)} ${payToken.symbol}` : "Connect a wallet to see"}</span>
            </div>
            {isConnected && side === "sell" && isEthMarket && (
              <div className="faint">
                {baseAvail > 0n ? `${fmt(baseAvail, 18)} WETH and ${fmt(wrappable, 18)} ETH` : "All ETH"}, keeping {fmt(NATIVE_GAS_RESERVE, 18)} ETH for gas
              </div>
            )}
            {isConnected && preview && payAllow < preview.need && (
              <div className="faint">First trade with {payToken.symbol}: your wallet will ask you to approve it once.</div>
            )}
          </div>

          <div aria-live="polite">
            {clause ? (
              <div className="clause">
                {clause}
                <div className="clause-sign">
                  <span>{isConnected ? `Signed by ${shortAddr(address)}` : "Signed by your wallet"}</span>
                  <span className="sig-line" />
                </div>
              </div>
            ) : (
              !preview?.selfCross && <p className="clause-empty">Enter {orderType === "limit" ? "a price and an amount" : "an amount"} to see the exact terms you'll sign.</p>
            )}
          </div>

          {problem && <div className={`form-problem ${problem.startsWith("Only ") ? "warn" : "danger"}`} role="alert">{problem}</div>}
          {offMarket && !problem && (
            <div className={`market-warn ${offMarket.severe ? "severe" : ""}`} role="alert">
              <span>{offMarket.text}</span>
              {offMarket.severe && (
                <label className="check" style={{ marginTop: 8 }}>
                  <input type="checkbox" checked={offMarketOk} onChange={e => setOffMarketOk(e.target.checked)} />
                  <span>I understand, place it anyway</span>
                </label>
              )}
            </div>
          )}

          {isConnected ? (
            <button className={`btn-lg ${side === "buy" ? "btn-buy" : "btn-sell"}`} onClick={submitOrder}
              disabled={!!loading || !preview || !!blocking || isWrongChain}>
              {loading ?? (isWrongChain ? "Switch to Ethereum to trade" : wrapNeeded > 0n ? `Wrap and sell ${B}` : `Sign and ${side} ${B}`)}
            </button>
          ) : (
            <button className="btn btn-lg" onClick={() => connect({ connector: injected() })}>Connect wallet to trade</button>
          )}
          <p className="faint" style={{ lineHeight: 1.5 }}>
            {wrapNeeded > 0n
              ? "Wrapping is one transaction and costs a little gas. Signing the order is free, and nothing leaves your wallet until the trade settles."
              : "Signing is free. Nothing leaves your wallet until the trade settles on Ethereum."}
          </p>
        </section>

        {/* Recent trades */}
        <section className="card trades-card" aria-label="Recent trades" style={{ padding: "18px 14px" }}>
          <h2 className="panel-title" style={{ fontFamily: "var(--sans)", margin: "0 6px 12px" }}>Recent trades</h2>
          <div className="book-head">
            <span>Price</span><span>Size</span><span>Time</span>
          </div>
          {marketFills.length === 0 ? (
            <div className="book-empty">No trades in {market.label} yet.</div>
          ) : (
            <div className="col" style={{ gap: 0, marginTop: 6 }}>
              {marketFills.slice(0, 18).map(f => (
                <a key={f.fillHash} className="trade-row" href={f.executionTx ? etherscanTx(f.executionTx) : `${EXPLORER}?hash=${f.fillHash}`} target="_blank" rel="noreferrer"
                  title={f.status === "settled" ? "View settlement" : "Settling on Ethereum"}>
                  <span className={f.takerSide}>{fmtPrice(market, f.price)}</span>
                  <span>{fmtBase(market, f.baseAmount)}</span>
                  <span className="muted">{f.status === "pending" ? "Settling" : new Date(f.settledAt ?? f.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                </a>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Your activity */}
      {isConnected && (
        <section className="card" style={{ marginTop: 16 }} aria-label="Your orders and trades">
          <div className="row-between" style={{ flexWrap: "wrap", marginBottom: 6 }}>
            <div className="tabs-underline" role="tablist">
              <button role="tab" aria-selected={activityTab === "open"} className={activityTab === "open" ? "on" : ""} onClick={() => setActivityTab("open")}>Open orders ({myOpen.length})</button>
              <button role="tab" aria-selected={activityTab === "trades"} className={activityTab === "trades" ? "on" : ""} onClick={() => setActivityTab("trades")}>Trade history</button>
            </div>
            <span className="muted" style={{ fontSize: 14 }}>
              In your wallet: {isEthMarket
                ? <>{fmt(nativeBalance + baseBalance, 18, 5)} ETH{baseBalance > 0n && ` (${fmt(baseBalance, 18, 5)} as WETH)`}</>
                : <>{fmtBase(market, baseBalance)} {B}</>} and {fmtQuote(market, quoteBalance)} {Q}
              {isEthMarket && baseAvail > 0n && !DEMO_MODE && (
                <button className="link-btn" style={{ marginLeft: 14 }} onClick={() => unwrapWeth(baseAvail)} disabled={!!loading}
                  title="WETH that isn't backing an open order can be turned back into ETH">
                  Convert {fmt(baseAvail, 18, 5)} WETH to ETH
                </button>
              )}
            </span>
          </div>

          <div style={{ marginTop: 14 }}>
          {activityTab === "open" ? (
            myOpen.length === 0 ? <p className="muted" style={{ fontSize: 15 }}>No open orders. When a limit order doesn't fill right away, it waits here until it fills, expires or you cancel it.</p> : (
              <div style={{ overflowX: "auto" }}>
                <table className="tbl">
                  <thead><tr><th>Market</th><th>Side</th><th>Price</th><th>Amount</th><th>Filled</th><th>Expires in</th><th></th></tr></thead>
                  <tbody>
                    {myOpen.map(o => (
                      <tr key={o.orderObj.objectHash}>
                        <td>{o.market.label}</td>
                        <td className={o.side}>{o.side === "buy" ? "Buy" : "Sell"}</td>
                        <td>{fmtPrice(o.market, o.price)}</td>
                        <td>{fmtBase(o.market, o.baseAmount)}</td>
                        <td>
                          {Number((o.filled * 1000n) / o.baseAmount) / 10}%
                          {o.pending > 0n && <span className="muted"> and {fmtBase(o.market, o.pending)} settling</span>}
                          {!o.funded && <span className="tag tag-warn" style={{ marginLeft: 8 }} title="Your wallet doesn't currently cover this order, so it's hidden from the book.">Needs funds</span>}
                        </td>
                        <td className="muted">{formatCountdown(Math.max(0, o.validBefore - nowSecs))}</td>
                        <td style={{ textAlign: "right" }}>
                          <div className="row" style={{ justifyContent: "flex-end", gap: 14 }}>
                            <button className="link-btn muted" onClick={() => cancelOrder(o, true)} disabled={!!loading}
                              title="Also revokes the order in the settlement contract, so nobody can settle it. Costs gas.">
                              Cancel on-chain
                            </button>
                            <button className="btn-secondary" style={{ fontSize: 14, padding: "6px 14px" }} onClick={() => cancelOrder(o)} disabled={!!loading}
                              title="Free. Every executor and interface stops matching this order.">
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            myFills.length === 0 ? <p className="muted" style={{ fontSize: 15 }}>No trades yet. Your fills appear here with their settlement progress.</p> : (
              <div style={{ overflowX: "auto" }}>
                <table className="tbl">
                  <thead><tr><th>Time</th><th>Market</th><th>Side</th><th>Price</th><th>Amount</th><th>Total</th><th>Settlement</th></tr></thead>
                  <tbody>
                    {myFills.map(f => {
                      const iTook = f.taker.toLowerCase() === me;
                      const bought = iTook ? f.takerSide === "buy" : f.takerSide === "sell";
                      return (
                        <tr key={f.fillHash}>
                          <td className="muted">{new Date(f.settledAt ?? f.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                          <td>{f.market.label}</td>
                          <td className={bought ? "buy" : "sell"}>{bought ? "Buy" : "Sell"}</td>
                          <td>{fmtPrice(f.market, f.price)}</td>
                          <td>{fmtBase(f.market, f.baseAmount)}</td>
                          <td>{fmtQuote(f.market, f.quoteAmount)}</td>
                          <td>
                            <a href={f.executionTx ? etherscanTx(f.executionTx) : `${EXPLORER}?hash=${f.fillHash}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}
                              title={f.executionTx ? "View the settlement transaction" : "View on AON"}>
                              {timeline(f)}
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
          </div>

        </section>
      )}

      {/* Price chart: Chainlink market price with Covenant's own trades on top */}
      {(() => {
        const since = Date.now() - 24 * 3600e3;
        const refData = refPrice !== null ? (reference?.history ?? []) : [];
        const trades = settledTrades
          .filter(t => (t.settledAt ?? t.createdAt) >= since)
          .map(t => ({ t: t.settledAt ?? t.createdAt, price: priceNumber(market, t.price), side: t.takerSide }));
        if (refData.length < 2 && trades.length === 0) return null;
        const all = [...refData.map(d => d.price), ...trades.map(d => d.price)];
        const minP = Math.min(...all), maxP = Math.max(...all);
        const pad = (maxP - minP) * 0.12 || maxP * 0.005 || 0.01;
        const tMin = Math.min(since, ...trades.map(d => d.t)), tMax = Date.now();
        const hhmm = (v: number) => new Date(v).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        // Rounded price ticks (steps of 1, 2, 2.5 or 5 × 10^n) and a time tick every 4 hours
        const lo = minP - pad, hi = maxP + pad, raw = (hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(raw));
        const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(v => v >= raw) ?? 10 * mag;
        const yTicks: number[] = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) yTicks.push(+v.toFixed(8));
        const H4 = 4 * 3600e3, xTicks: number[] = []; for (let v = Math.ceil(tMin / H4) * H4; v <= tMax; v += H4) xTicks.push(v);
        return (
          <section className="card" style={{ marginTop: 16 }} aria-label="Price, last 24 hours">
            <div className="row-between" style={{ marginBottom: 14, flexWrap: "wrap" }}>
              <h2 className="panel-title" style={{ fontFamily: "var(--sans)" }}>{market.label} price, last 24 hours</h2>
              <div className="chart-legend">
                {refData.length > 1 && <span><i className="lg-line" />Market price (Chainlink)</span>}
                <span><i className="lg-dot buy" /><i className="lg-dot sell" />Covenant trades</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart margin={{ top: 6, right: 8, left: -6, bottom: 0 }}>
                <XAxis dataKey="t" type="number" scale="time" domain={[tMin, tMax]} ticks={xTicks} tickFormatter={hhmm}
                  tick={{ fill: "var(--faint)", fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={40} />
                <YAxis dataKey="price" type="number" domain={[lo, hi]} ticks={yTicks} width={70}
                  tick={{ fill: "var(--faint)", fontSize: 12 }} axisLine={false} tickLine={false}
                  tickFormatter={v => Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} />
                <Tooltip cursor={{ stroke: "var(--line-strong)" }}
                  contentStyle={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, fontFamily: "var(--sans)" }}
                  labelFormatter={(v: any) => new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  formatter={(v: any, name: any) => [`${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${Q}`, name]} />
                {refData.length > 1 && (
                  <Line data={refData} dataKey="price" name="Market price" type="stepAfter" stroke="#8A93A3" strokeWidth={1.5}
                    strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                )}
                <Scatter data={trades.filter(d => d.side === "buy")} dataKey="price" name="Trade (buy)" fill="var(--buy)" isAnimationActive={false} />
                <Scatter data={trades.filter(d => d.side === "sell")} dataKey="price" name="Trade (sell)" fill="var(--sell)" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            {trades.length === 0 && <p className="faint" style={{ marginTop: 8 }}>No Covenant trades in the last 24 hours yet.</p>}
          </section>
        );
      })()}

      {logs.length > 0 && (
        <details className="card" style={{ marginTop: 16 }}>
          <summary className="panel-title" style={{ cursor: "pointer" }}>Activity log ({logs.length})</summary>
          <div className="col" style={{ gap: 6, marginTop: 12 }}>
            {logs.map((l, i) => (
              <div key={i} className="muted" style={{ fontSize: 13 }}>{new Date(l.ts).toLocaleTimeString()} {l.text}</div>
            ))}
          </div>
        </details>
      )}
    </main>
  );
}
