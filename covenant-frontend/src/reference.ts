/**
 * Market reference prices from Chainlink, read on-chain.
 *
 * Uses the Chainlink Feed Registry (docs.chain.link/data-feeds/feed-registry):
 * one contract that maps (base asset, quote asset) to its price feed. Markets
 * with no Chainlink feed simply get no reference — nothing is hardcoded that
 * could point at the wrong feed.
 *
 * Prices are converted from USD to USDT with Chainlink's USDT/USD feed, so the
 * reference is in the market's own quote currency.
 */

import type { PublicClient } from "viem";
import { TOKENS, type Market } from "./config";

export const FEED_REGISTRY = "0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf" as const;
export const DENOM = {
  ETH: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  USD: "0x0000000000000000000000000000000000000348",
} as const;

const registryAbi = [
  { type: "function", name: "decimals", stateMutability: "view",
    inputs: [{ name: "base", type: "address" }, { name: "quote", type: "address" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "latestRoundData", stateMutability: "view",
    inputs: [{ name: "base", type: "address" }, { name: "quote", type: "address" }],
    outputs: [{ name: "roundId", type: "uint80" }, { name: "answer", type: "int256" }, { name: "startedAt", type: "uint256" }, { name: "updatedAt", type: "uint256" }, { name: "answeredInRound", type: "uint80" }] },
  { type: "function", name: "getRoundData", stateMutability: "view",
    inputs: [{ name: "base", type: "address" }, { name: "quote", type: "address" }, { name: "roundId", type: "uint80" }],
    outputs: [{ name: "roundId", type: "uint80" }, { name: "answer", type: "int256" }, { name: "startedAt", type: "uint256" }, { name: "updatedAt", type: "uint256" }, { name: "answeredInRound", type: "uint80" }] },
] as const;

// The Chainlink asset id for a market's base token (ETH uses a denomination address)
const assetFor = (m: Market) => (m.base.wrapsNative ? DENOM.ETH : m.base.address);

// Feeds update on a heartbeat (at most this long between updates) or on price
// deviation. Older than this and we treat the reference as unavailable.
const MAX_AGE_SECS = 26 * 3600;
const HISTORY_SECS = 24 * 3600;
const MAX_HISTORY_ROUNDS = 120;

export type RefPoint = { t: number; price: number };          // t = unix ms, price in quote per base
export type Reference = {
  price:     number;        // latest, in the market's quote currency (USDT)
  updatedAt: number;        // unix ms
  stale:     boolean;
  history:   RefPoint[];    // oldest first, covering the last 24h
  quoteIsUsd: boolean;      // true if the USDT/USD conversion wasn't available
};

type Round = { id: bigint; answer: bigint; updatedAt: bigint };

async function latest(pc: PublicClient, base: string, quote: string): Promise<Round & { decimals: number }> {
  const [r, decimals] = await Promise.all([
    pc.readContract({ address: FEED_REGISTRY, abi: registryAbi, functionName: "latestRoundData", args: [base as any, quote as any] }),
    pc.readContract({ address: FEED_REGISTRY, abi: registryAbi, functionName: "decimals", args: [base as any, quote as any] }),
  ]);
  return { id: r[0], answer: r[1], updatedAt: r[3], decimals: Number(decimals) };
}

// Round ids are (phaseId << 64 | aggregatorRoundId). Walk back within the
// current phase only; earlier phases are a different aggregator.
async function walkBack(pc: PublicClient, base: string, quote: string, from: bigint, sinceSecs: number): Promise<Round[]> {
  const phase = from >> 64n;
  let agg = from & ((1n << 64n) - 1n);
  const out: Round[] = [];
  while (agg > 1n && out.length < MAX_HISTORY_ROUNDS) {
    const ids: bigint[] = [];
    for (let i = 0; i < 12 && agg - 1n - BigInt(i) >= 1n; i++) ids.push((phase << 64n) | (agg - 1n - BigInt(i)));
    const rounds = await Promise.all(ids.map(id =>
      pc.readContract({ address: FEED_REGISTRY, abi: registryAbi, functionName: "getRoundData", args: [base as any, quote as any, id] })
        .then(r => ({ id, answer: r[1], updatedAt: r[3] }))
        .catch(() => null)));
    let reachedStart = false;
    for (const r of rounds) {
      if (!r || r.updatedAt === 0n) continue;
      out.push(r);
      if (Number(r.updatedAt) < sinceSecs) reachedStart = true;
    }
    agg -= BigInt(ids.length);
    if (reachedStart || rounds.every(r => !r)) break;
  }
  return out;
}

const toNum = (v: bigint, d: number) => Number(v) / 10 ** d;

const cache = new Map<string, { at: number; ref: Reference | null }>();
const inflight = new Map<string, Promise<Reference | null>>();

/** Latest reference + 24h history for a market. Returns null if Chainlink has no feed. */
export function getReference(pc: PublicClient, m: Market, maxAgeMs = 60_000): Promise<Reference | null> {
  const hit = cache.get(m.key);
  if (hit && Date.now() - hit.at < maxAgeMs) return Promise.resolve(hit.ref);
  if (inflight.has(m.key)) return inflight.get(m.key)!;

  const p = (async (): Promise<Reference | null> => {
    const base = assetFor(m);
    let px: Round & { decimals: number };
    try { px = await latest(pc, base, DENOM.USD); } catch { return null; } // no Chainlink feed for this asset

    // USD -> USDT
    let usdt: (Round & { decimals: number }) | null = null;
    if (m.quote.address.toLowerCase() === TOKENS.USDT.address.toLowerCase()) {
      usdt = await latest(pc, TOKENS.USDT.address, DENOM.USD).catch(() => null);
    }
    const usdtPerUsd = usdt && usdt.answer > 0n ? 1 / toNum(usdt.answer, usdt.decimals) : 1;

    const nowSecs = Math.floor(Date.now() / 1000);
    const since = nowSecs - HISTORY_SECS;
    const prev = hit?.ref?.history ?? [];
    const lastKnown = prev.length ? prev[prev.length - 1].t / 1000 : 0;

    // Only fetch rounds we haven't seen
    const back = await walkBack(pc, base, DENOM.USD, px.id, Math.max(since, lastKnown));
    const points = [...back.reverse(), { id: px.id, answer: px.answer, updatedAt: px.updatedAt }]
      .filter(r => r.answer > 0n && Number(r.updatedAt) >= since)
      .map(r => ({ t: Number(r.updatedAt) * 1000, price: toNum(r.answer, px.decimals) * usdtPerUsd }));
    const merged = [...prev.filter(pt => pt.t / 1000 >= since), ...points]
      .sort((a, b) => a.t - b.t)
      .filter((pt, i, a) => i === 0 || pt.t !== a[i - 1].t);

    return {
      price:      toNum(px.answer, px.decimals) * usdtPerUsd,
      updatedAt:  Number(px.updatedAt) * 1000,
      stale:      nowSecs - Number(px.updatedAt) > MAX_AGE_SECS || px.answer <= 0n,
      history:    merged,
      quoteIsUsd: !usdt,
    };
  })().then(ref => { cache.set(m.key, { at: Date.now(), ref }); return ref; })
     .finally(() => inflight.delete(m.key));

  inflight.set(m.key, p);
  return p;
}

/** How far a price is from the reference, as a fraction (+0.12 = 12% above). */
export const deviation = (price: number, ref: number) => (price - ref) / ref;
