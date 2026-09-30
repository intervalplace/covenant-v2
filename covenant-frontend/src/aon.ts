/**
 * AON integration for Covenant on the aon:evm-spot namespace.
 * All market state is read from the AON node — there is no Covenant backend.
 */

import {
  getAddress, hashTypedData, verifyTypedData, formatUnits, parseUnits,
  type Address, type Hex,
} from "viem";
import {
  AON_NODE_URL, NAMESPACE, MARKETS, SETTLEMENT_CONTRACT, CHAIN_ID,
  AUTH_TYPES, ORDER_TYPES, REVOCATION_TYPES, getEvmSpotDomain,
  SIDE_BUY_BASE, SIDE_SELL_BASE, sideMaskFor, marketById, type Market,
} from "./config";
import type {
  AonObject, AuthMessage, OrderMessage, RestingOrder, FillView, Side,
} from "./types";

// ── Node client ───────────────────────────────────────────────────────────────

export async function aonPutObject(obj: any): Promise<{ objectHash: string }> {
  const res = await fetch(`${AON_NODE_URL}/v1/objects`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(obj),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(body.error?.code ?? body.error?.message ?? `AON_PUT_FAILED: ${res.status}`);
  }
  return { objectHash: body.objectHash };
}

// Pulls the whole namespace (paged). Fine at demo scale.
export async function fetchNamespaceObjects(maxPages = 5): Promise<AonObject[]> {
  const out: AonObject[] = [];
  const pageSize = 1000;
  for (let page = 0; page < maxPages; page++) {
    const res = await fetch(
      `${AON_NODE_URL}/v1/objects?namespace=${encodeURIComponent(NAMESPACE)}&limit=${pageSize}&offset=${page * pageSize}`
    );
    if (!res.ok) throw new Error(`AON_GET_FAILED: ${res.status}`);
    const data = await res.json();
    const objs = (data.objects ?? []) as AonObject[];
    out.push(...objs);
    if (objs.length < pageSize || out.length >= (data.total ?? 0)) break;
  }
  return out;
}

// ── Units ─────────────────────────────────────────────────────────────────────
// Contract price = quote units per 1e18 base units, scaled by 1e18:
//   quoteAmount = baseAmount * price / 1e18
// So for a human price P (quote per whole base token):
//   price = P * 10^(quoteDecimals + 18 - baseDecimals)

export const priceDecimals = (m: Market) => m.quote.decimals + 18 - m.base.decimals;

export const toBaseUnits  = (m: Market, human: string) => parseUnits(clean(human), m.base.decimals);
export const toQuoteUnits = (m: Market, human: string) => parseUnits(clean(human), m.quote.decimals);
export const toPrice      = (m: Market, human: string) => parseUnits(clean(human), priceDecimals(m));
export const quoteFor     = (base: bigint, price: bigint) => (base * price) / 10n ** 18n;

function clean(x: string) {
  const s = (x ?? "").trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") throw new Error("INVALID_NUMBER");
  return s;
}

export function fmt(units: bigint, decimals: number, maxFrac = 6) {
  const n = Number(formatUnits(units, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
}
export const fmtBase  = (m: Market, u: bigint) => fmt(u, m.base.decimals, 6);
export const fmtQuote = (m: Market, u: bigint) => fmt(u, m.quote.decimals, 2);
export const fmtPrice = (m: Market, p: bigint) => fmt(p, priceDecimals(m), 4);
export const priceToInput = (m: Market, p: bigint) => formatUnits(p, priceDecimals(m));
export const priceNumber = (m: Market, p: bigint) => Number(formatUnits(p, priceDecimals(m)));

// ── Signature verification (cached per object hash) ───────────────────────────

const verified = new Map<string, boolean>();

function stable(x: any): string {
  if (x === null || typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(stable).join(",")}]`;
  return `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${stable(x[k])}`).join(",")}}`;
}

function domainOk(d: any) {
  return d
    && Number(d.chainId) === CHAIN_ID
    && d.name === "AON EVM Spot"
    && String(d.verifyingContract ?? "").toLowerCase() === SETTLEMENT_CONTRACT.toLowerCase();
}

async function verifySigned(obj: AonObject, payloadMsg: any, primaryType: string, expectedSigner: string) {
  const key = obj.objectHash.toLowerCase();
  if (verified.has(key)) return verified.get(key)!;
  let ok = false;
  try {
    const s = obj.signature ?? obj.payload?.signature;
    ok = !!s
      && domainOk(s.domain)
      && s.primaryType === primaryType
      && stable(s.message) === stable(payloadMsg)
      && String(s.signer).toLowerCase() === expectedSigner.toLowerCase()
      && await verifyTypedData({
           address: getAddress(expectedSigner), domain: s.domain, types: s.types,
           primaryType: s.primaryType, message: s.message, signature: s.signature,
         } as any);
  } catch { ok = false; }
  verified.set(key, ok);
  return ok;
}

const eip712Cache = new Map<string, Hex>();
function authEip712(a: AuthMessage): Hex {
  return hashTypedData({ domain: getEvmSpotDomain(), types: AUTH_TYPES, primaryType: "TradingSessionAuthorization", message: a as any });
}
export function orderEip712(o: OrderMessage, cacheKey?: string): Hex {
  if (cacheKey && eip712Cache.has(cacheKey)) return eip712Cache.get(cacheKey)!;
  const h = hashTypedData({ domain: getEvmSpotDomain(), types: ORDER_TYPES, primaryType: "SignedOrder", message: o as any });
  if (cacheKey) eip712Cache.set(cacheKey, h);
  return h;
}

// ── Market state derivation ───────────────────────────────────────────────────
//
// Every signed order is one object that can be filled many times, in either
// role: it can take liquidity when submitted and then rest on the book as a
// maker for whatever is left. The contract tracks filledBaseByOrder per order,
// regardless of role, so "remaining" is simply size minus all fills.

// Unsettled fills reserve size for this long, then are treated as failed.
export const PENDING_FILL_WINDOW_MS = 10 * 60 * 1000;
const isRealTx = (tx?: string) => /^0x[0-9a-fA-F]{64}$/.test(tx ?? "");

// On-chain facts, when an RPC is available. With these, "settled" means the
// contract consumed the fill's nonce — AON receipts are only used for the tx link.
export type ChainFacts = {
  filled:     Map<string, bigint>; // order EIP-712 hash -> filledBaseByOrder
  usedNonces: Set<string>;         // fill nonces the contract has consumed
};

export type MarketState = {
  orders: RestingOrder[];   // every valid, unexpired, uncancelled order (incl. filled ones)
  fills:  FillView[];
};

export async function deriveState(
  objects: AonObject[],
  chain?: ChainFacts,
): Promise<MarketState> {
  const onchainFilled = chain?.filled ?? new Map<string, bigint>();
  const now = Date.now();
  const nowSecs = Math.floor(now / 1000);
  const byHash = new Map(objects.map(o => [o.objectHash.toLowerCase(), o]));
  const of = (t: string) => objects.filter(o => o.objectType === t);

  // 1. Valid authorizations for our markets
  const auths = new Map<string, AonObject>();
  for (const o of of("authorization")) {
    const a = o.payload?.authorization as AuthMessage | undefined;
    if (o.payload?.authorizationType !== "evm_spot_session" || !a) continue;
    const m = marketById(a.marketId);
    if (!m) continue;
    if (a.baseToken?.toLowerCase()  !== m.base.address.toLowerCase())  continue;
    if (a.quoteToken?.toLowerCase() !== m.quote.address.toLowerCase()) continue;
    if (a.settlementContract?.toLowerCase() !== SETTLEMENT_CONTRACT.toLowerCase()) continue;
    if (!(await verifySigned(o, a, "TradingSessionAuthorization", a.grantor))) continue;
    auths.set(o.objectHash.toLowerCase(), o);
  }

  // 2. Revocations — collected now, checked against owners after orders load
  const revocations: { target: string; r: AonObject }[] = [];
  for (const r of of("revocation")) {
    const target = String(r.payload?.targetHash ?? "").toLowerCase();
    if (target && (r.references ?? []).map(x => x.toLowerCase()).includes(target)) revocations.push({ target, r });
  }

  // 3. Valid orders bound to a valid auth
  type O = { obj: AonObject; o: OrderMessage; auth: AonObject; eip: Hex };
  const orders = new Map<string, O>();
  for (const obj of of("order")) {
    const o = obj.payload?.order as OrderMessage | undefined;
    if (obj.payload?.orderType !== "evm_spot_order" || !o) continue;
    const auth = auths.get(String(obj.references?.[0] ?? "").toLowerCase());
    if (!auth) continue;
    const a = auth.payload.authorization as AuthMessage;
    if (o.trader.toLowerCase() !== a.grantor.toLowerCase()) continue;
    if (o.marketId.toLowerCase() !== a.marketId.toLowerCase()) continue;
    if (sideMaskFor(o.side) !== Number(a.sideMask)) continue;
    if (o.sessionAuthHash.toLowerCase() !== authEip712(a).toLowerCase()) continue;
    // The order's limit price must be inside its authorization's price band
    if (BigInt(o.price) < BigInt(a.minPrice) || BigInt(o.price) > BigInt(a.maxPrice)) continue;
    // Native payout is only valid on buy orders in a wrapped-native market
    if (typeof o.receiveNative !== "boolean") continue;
    if (o.receiveNative && (o.side !== SIDE_BUY_BASE || !marketById(o.marketId)?.base.wrapsNative)) continue;
    if (!(await verifySigned(obj, o, "SignedOrder", o.trader))) continue;
    orders.set(obj.objectHash.toLowerCase(), { obj, o, auth, eip: orderEip712(o, obj.objectHash) });
  }

  // 3b. Apply revocations signed by the target's owner
  //     (authorization → grantor, order → trader)
  const revoked = new Set<string>();
  for (const { target, r } of revocations) {
    const owner = auths.get(target)?.payload.authorization.grantor ?? orders.get(target)?.o.trader;
    if (!owner) continue;
    const s = r.payload?.signature;
    const msg = { targetHash: r.payload?.targetHash, targetType: r.payload?.targetType, reason: r.payload?.reason, nonce: r.payload?.nonce };
    if (s && stable(s.message) === stable(msg)
        && await verifySigned({ ...r, signature: s }, msg, "AonRevocation", owner)) {
      revoked.add(target);
    }
  }
  const isRevoked = (x: O) => revoked.has(x.obj.objectHash.toLowerCase()) || revoked.has(x.auth.objectHash.toLowerCase());
  const isExpired = (x: O) => Math.min(Number(x.o.validBefore), Number(x.auth.payload.authorization.validBefore)) < nowSecs;

  // 4. Receipts by fill hash
  const receiptFor = new Map<string, AonObject>();
  for (const r of of("receipt")) {
    if (!isRealTx(r.payload?.executionTx)) continue;
    for (const ref of r.references ?? []) {
      const h = ref.toLowerCase();
      if (byHash.get(h)?.objectType === "fill" && !receiptFor.has(h)) receiptFor.set(h, r);
    }
  }

  // 5. Fills — credited to both orders involved
  const fills: FillView[] = [];
  const settledBy  = new Map<string, bigint>();
  const reservedBy = new Map<string, bigint>();
  const feeUsedByAuth = new Map<string, bigint>();
  const add = (m: Map<string, bigint>, k: string, v: bigint) => m.set(k, (m.get(k) ?? 0n) + v);

  for (const f of of("fill")) {
    const d = f.payload?.fill;
    if (f.payload?.fillType !== "evm_spot_fill" || !d) continue;
    const mk = orders.get(String(d.makerOrderHash).toLowerCase());
    const tk = orders.get(String(d.takerOrderHash).toLowerCase());
    if (!mk || !tk) continue;
    const receipt = receiptFor.get(f.objectHash.toLowerCase());
    const base = BigInt(d.baseAmount);
    const settled = chain
      ? chain.usedNonces.has(String(d.fillNonce).toLowerCase())
      : !!receipt;
    // A fill can't settle once either side is cancelled or expired
    const dead = isRevoked(mk) || isRevoked(tk) || isExpired(mk) || isExpired(tk);
    const status = settled ? "settled"
      : !dead && now - f.createdAt < PENDING_FILL_WINDOW_MS ? "pending" : "stale";
    fills.push({
      fillHash:    f.objectHash,
      market:      marketById(mk.o.marketId)!,
      takerSide:   tk.o.side === SIDE_BUY_BASE ? "buy" : "sell",
      maker:       mk.o.trader,
      taker:       tk.o.trader,
      makerOrderHash: mk.obj.objectHash,
      takerOrderHash: tk.obj.objectHash,
      fillNonce:   d.fillNonce,
      price:       BigInt(d.price),
      baseAmount:  base,
      quoteAmount: BigInt(d.quoteAmount),
      status,
      executionTx: settled ? receipt?.payload?.executionTx : undefined,
      createdAt:   f.createdAt,
      settledAt:   receipt?.createdAt,
    });
    if (status === "stale") continue;
    for (const side of [mk, tk]) {
      const k = side.obj.objectHash.toLowerCase();
      add(status === "settled" ? settledBy : reservedBy, k, base);
    }
    const buyerAuth = (mk.o.side === SIDE_BUY_BASE ? mk : tk).auth.objectHash.toLowerCase();
    add(feeUsedByAuth, buyerAuth, BigInt(d.executorFeeQuoteAmount ?? 0));
  }

  // 6. Orders with their live remaining size
  const out: RestingOrder[] = [];
  for (const [h, { obj, o, auth, eip }] of orders) {
    const a = auth.payload.authorization as AuthMessage;
    const validBefore = Math.min(Number(o.validBefore), Number(a.validBefore));
    const total = BigInt(o.baseAmount);
    const settled = [settledBy.get(h) ?? 0n, onchainFilled.get(eip.toLowerCase()) ?? 0n]
      .reduce((x, y) => (x > y ? x : y));
    const reserved = reservedBy.get(h) ?? 0n;
    const remaining = total - settled - reserved;
    const isBuy = o.side === SIDE_BUY_BASE;
    const feeLeft = BigInt(a.maxExecutorFeeQuote) - (feeUsedByAuth.get(auth.objectHash.toLowerCase()) ?? 0n);
    out.push({
      market:      marketById(o.marketId)!,
      side:        isBuy ? "buy" : "sell",
      maker:       o.trader,
      price:       BigInt(o.price),
      baseAmount:  total,
      filled:      settled,
      pending:     reserved,
      remaining:   remaining > 0n ? remaining : 0n,
      validBefore,
      createdAt:   obj.createdAt,
      cancelled:   isRevoked({ obj, o, auth, eip }),
      expired:     validBefore <= nowSecs + 60,
      feeBudgetLeft: isBuy && feeLeft > 0n ? feeLeft : 0n,
      funded:      true,
      authObj:     auth,
      orderObj:    obj,
      orderEip712: eip,
    });
  }

  fills.sort((x, y) => y.createdAt - x.createdAt);
  out.sort((x, y) => y.createdAt - x.createdAt);
  return { orders: out, fills };
}

// Orders that can actually be traded against right now
export const isLive = (o: RestingOrder) => !o.cancelled && !o.expired && o.remaining > 0n;

const needFor = (o: RestingOrder) => o.side === "sell"
  ? { token: o.market.base.address,  amount: o.remaining }
  : { token: o.market.quote.address, amount: quoteFor(o.remaining, o.price) + o.feeBudgetLeft };

// Marks each live order funded/unfunded given each maker's spendable amount
// (min of balance and allowance) per token. A maker's orders are funded in
// book priority — best price first — until their balance runs out, so two
// orders sharing one balance can't both appear fully backed.
export function applyFunding(orders: RestingOrder[], capacity: Map<string, bigint>) {
  const live = orders.filter(isLive).sort((a, b) =>
    a.side !== b.side ? (a.side < b.side ? -1 : 1)
    : a.price === b.price ? a.createdAt - b.createdAt
    : a.side === "sell" ? (a.price < b.price ? -1 : 1) : (a.price > b.price ? -1 : 1));
  const used = new Map<string, bigint>();
  for (const o of live) {
    const { token, amount } = needFor(o);
    const k = `${o.maker.toLowerCase()}:${token.toLowerCase()}`;
    const next = (used.get(k) ?? 0n) + amount;
    o.funded = next <= (capacity.get(k) ?? 0n);
    if (o.funded) used.set(k, next);
  }
}

// What a maker needs in their wallet for all their live orders on one token
export function commitmentsByMakerToken(orders: RestingOrder[]) {
  const out = new Map<string, bigint>(); // `${maker}:${token}` -> amount
  for (const o of orders.filter(isLive)) {
    const { token, amount } = needFor(o);
    const k = `${o.maker.toLowerCase()}:${token.toLowerCase()}`;
    out.set(k, (out.get(k) ?? 0n) + amount);
  }
  return out;
}

// ── Matching ──────────────────────────────────────────────────────────────────
// Price-time priority against the live book. Fills execute at the resting
// order's price, so a limit buy at 3010 against an ask at 3005 pays 3005.

export type MatchLeg = { order: RestingOrder; base: bigint; price: bigint; quote: bigint };
export type MatchResult = {
  legs:      MatchLeg[];
  filled:    bigint;          // base filled immediately
  quote:     bigint;          // quote exchanged immediately
  avgPrice:  bigint | null;   // contract price units
  worstPrice: bigint | null;
  remainder: bigint;          // base left to rest on the book (limit orders)
  selfCross: boolean;         // would trade against your own order
};

export const MAX_LEGS_PER_ORDER = 10;

export function matchOrder(args: {
  book: RestingOrder[]; market: Market; side: Side; amount: bigint;
  limit: bigint | null;       // null = market order
  me?: string;
}): MatchResult {
  const me = args.me?.toLowerCase();
  const opposite = args.book
    .filter(o => o.market.key === args.market.key && isLive(o) && o.funded
      && o.side === (args.side === "buy" ? "sell" : "buy"))
    .filter(o => args.limit === null || (args.side === "buy" ? o.price <= args.limit : o.price >= args.limit))
    .sort((a, b) =>
      a.price === b.price ? a.createdAt - b.createdAt
      : args.side === "buy" ? (a.price < b.price ? -1 : 1) : (a.price > b.price ? -1 : 1));

  const legs: MatchLeg[] = [];
  let left = args.amount, quote = 0n, selfCross = false;
  for (const o of opposite) {
    if (left === 0n || legs.length >= MAX_LEGS_PER_ORDER) break;
    if (me && o.maker.toLowerCase() === me) { selfCross = true; break; }
    const base = left < o.remaining ? left : o.remaining;
    const q = quoteFor(base, o.price);
    if (q === 0n) continue;
    legs.push({ order: o, base, price: o.price, quote: q });
    left -= base; quote += q;
  }
  const filled = args.amount - left;
  return {
    legs, filled, quote,
    avgPrice:   filled > 0n ? (quote * 10n ** 18n) / filled : null,
    worstPrice: legs.length ? legs[legs.length - 1].price : null,
    remainder:  args.limit === null ? 0n : left,
    selfCross,
  };
}

// ── Object construction (mirrors aon-namespace-evm-spot/src/builders.ts) ──────

export function randomHex32(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

const MAX_UINT256 = (1n << 256n) - 1n;

// One authorization per order. Its bounds are exactly what the order can use:
// a buy may spend up to amount × limit (fills at better prices use less),
// a sell may deliver up to amount. The price band lets the order fill at its
// limit or better, which is what allows one order to sweep several levels.
export function buildAuthMessage(args: {
  market: Market; grantor: Address; side: number;
  baseAmount: bigint; limitPrice: bigint; maxFee: bigint; ttlSecs: number;
}): AuthMessage {
  const now = Math.floor(Date.now() / 1000);
  const selling = args.side === SIDE_SELL_BASE;
  return {
    grantor:             getAddress(args.grantor),
    settlementContract:  getAddress(SETTLEMENT_CONTRACT),
    baseToken:           getAddress(args.market.base.address),
    quoteToken:          getAddress(args.market.quote.address),
    marketId:            args.market.marketId,
    sideMask:            sideMaskFor(args.side),
    maxBaseExposure:     (selling ? args.baseAmount : 0n).toString(),
    maxQuoteExposure:    (selling ? 0n : quoteFor(args.baseAmount, args.limitPrice)).toString(),
    maxExecutorFeeQuote: (selling ? 0n : args.maxFee).toString(),
    minPrice:            (selling ? args.limitPrice : 0n).toString(),
    maxPrice:            (selling ? MAX_UINT256 : args.limitPrice).toString(),
    validAfter:          String(now - 60),
    validBefore:         String(now + args.ttlSecs),
    authNonce:           randomHex32(),
  };
}

export function buildOrderMessage(args: {
  market: Market; trader: Address; side: number; price: bigint;
  baseAmount: bigint; auth: AuthMessage; receiveNative?: boolean;
}): OrderMessage {
  // Only a buy order on a wrapped-native market can ask for native payout;
  // the contract rejects it anywhere else.
  const native = !!args.receiveNative && args.side === SIDE_BUY_BASE && !!args.market.base.wrapsNative;
  return {
    trader:          getAddress(args.trader),
    marketId:        args.market.marketId,
    side:            args.side,
    price:           args.price.toString(),
    baseAmount:      args.baseAmount.toString(),
    orderNonce:      randomHex32(),
    sessionAuthHash: authEip712(args.auth),
    validAfter:      args.auth.validAfter,
    validBefore:     args.auth.validBefore,
    receiveNative:   native,
  };
}

// EIP-712 messages with bigint uints, for wallet signing.
export const authForSigning = (a: AuthMessage) => ({
  ...a,
  maxBaseExposure: BigInt(a.maxBaseExposure), maxQuoteExposure: BigInt(a.maxQuoteExposure),
  maxExecutorFeeQuote: BigInt(a.maxExecutorFeeQuote), minPrice: BigInt(a.minPrice), maxPrice: BigInt(a.maxPrice),
  validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore),
});
export const orderForSigning = (o: OrderMessage) => ({
  ...o,
  price: BigInt(o.price), baseAmount: BigInt(o.baseAmount),
  validAfter: BigInt(o.validAfter), validBefore: BigInt(o.validBefore),
});

export function authObject(finalize: (o: any) => any, a: AuthMessage, sig: Hex) {
  return finalize({
    objectType: "authorization", schemaVersion: "1", namespace: NAMESPACE,
    createdAt: Date.now(), references: [],
    payload: { authorizationType: "evm_spot_session", authorization: a },
    signature: {
      scheme: "eip712", signer: a.grantor, domain: getEvmSpotDomain(),
      types: AUTH_TYPES, primaryType: "TradingSessionAuthorization", message: a, signature: sig,
    },
  });
}

export function orderObject(finalize: (o: any) => any, authHash: string, o: OrderMessage, sig: Hex) {
  return finalize({
    objectType: "order", schemaVersion: "1", namespace: NAMESPACE,
    createdAt: Date.now(), references: [authHash.toLowerCase()],
    payload: { orderType: "evm_spot_order", order: o },
    signature: {
      scheme: "eip712", signer: o.trader, domain: getEvmSpotDomain(),
      types: ORDER_TYPES, primaryType: "SignedOrder", message: o, signature: sig,
    },
  });
}

export function fillObject(finalize: (o: any) => any, args: {
  makerAuthHash: string; takerAuthHash: string; makerOrderHash: string; takerOrderHash: string;
  price: bigint; baseAmount: bigint; executorFee: bigint;
}) {
  const [mA, tA, mO, tO] = [args.makerAuthHash, args.takerAuthHash, args.makerOrderHash, args.takerOrderHash]
    .map(h => h.toLowerCase());
  return finalize({
    objectType: "fill", schemaVersion: "1", namespace: NAMESPACE,
    createdAt: Date.now(), references: [mA, tA, mO, tO],
    payload: {
      fillType: "evm_spot_fill",
      fill: {
        makerOrderHash: mO, takerOrderHash: tO, makerAuthHash: mA, takerAuthHash: tA,
        price:                  args.price.toString(),
        baseAmount:             args.baseAmount.toString(),
        quoteAmount:            quoteFor(args.baseAmount, args.price).toString(),
        executorFeeQuoteAmount: args.executorFee.toString(),
        fillNonce:              randomHex32(),
        settlementContract:     getAddress(SETTLEMENT_CONTRACT),
      },
    },
  });
}

export function revocationMessage(authObj: AonObject) {
  return {
    targetHash: authObj.objectHash.toLowerCase() as Hex,
    targetType: "authorization",
    reason:     "maker_cancelled",
    nonce:      randomHex32(),
  };
}

export function revocationObject(
  finalize: (o: any) => any, authObj: AonObject, msg: ReturnType<typeof revocationMessage>, sig: Hex,
) {
  const signer = authObj.payload.authorization.grantor;
  return finalize({
    objectType: "revocation", schemaVersion: "1", namespace: NAMESPACE,
    createdAt: Date.now(), references: [msg.targetHash],
    payload: {
      revocationType: "authorization_revocation",
      targetType: msg.targetType, targetHash: msg.targetHash, reason: msg.reason, nonce: msg.nonce,
      signature: {
        scheme: "eip712", signer, domain: getEvmSpotDomain(),
        types: REVOCATION_TYPES, primaryType: "AonRevocation", message: msg, signature: sig,
      },
    },
  });
}

// ── Misc helpers ──────────────────────────────────────────────────────────────

export function shortHash(h?: string, n = 8) {
  if (!h) return "—";
  return `${h.slice(0, 2 + n)}…${h.slice(-6)}`;
}
export const shortAddr = (x?: string) => (x ? `${x.slice(0, 6)}…${x.slice(-4)}` : "");

export function formatCountdown(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

export { SIDE_BUY_BASE, SIDE_SELL_BASE };
export type { Side };
