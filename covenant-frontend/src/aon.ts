/**
 * AON integration helpers for the Covenant frontend.
 * All coordination goes through the AON node — no central backend.
 */

import { AON_NODE_URL, COVENANT_SERVER } from "./config";
import type { SellOffer, BuyerAuth, AonReceipt } from "./types";

// ── AON node client ───────────────────────────────────────────────────────────

async function aonGet(path: string) {
  const res = await fetch(`${AON_NODE_URL}/v1${path}`);
  if (!res.ok) throw new Error(`AON_GET_FAILED: ${path} → ${res.status}`);
  return res.json();
}

export async function aonPutObject(obj: any): Promise<{ objectHash: string }> {
  const res = await fetch(`${AON_NODE_URL}/v1/objects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message ?? `AON_PUT_FAILED: ${res.status}`);
  }
  return res.json();
}

// ── Sell offers ───────────────────────────────────────────────────────────────

export async function fetchSellOffers(): Promise<SellOffer[]> {
  const data = await aonGet("/objects?objectType=csd_sell_offer&namespace=aon:csd-usdc&limit=100");
  const now  = Math.floor(Date.now() / 1000);
  return (data.objects ?? [])
    .filter((o: any) => {
      const p = o.payload;
      return p?.validBefore > now && BigInt(p?.csdAmount ?? 0) > 0n;
    })
    .map((o: any) => ({
      objectHash: o.objectHash,
      payload:    o.payload,
      createdAt:  o.createdAt,
    }));
}

// ── Buyer authorizations ──────────────────────────────────────────────────────

export async function fetchMyBuyerAuth(buyerAddress: string): Promise<BuyerAuth | null> {
  const data = await aonGet("/objects?objectType=authorization&namespace=aon:csd-usdc&limit=50");
  const now  = Math.floor(Date.now() / 1000);
  const auth = [...(data.objects ?? [])]
    .filter((o: any) => {
      const a = o.payload?.authorization;
      if (!a) return false;
      if (a.buyer?.toLowerCase() !== buyerAddress.toLowerCase()) return false;
      if (Number(a.validBefore) <= now) return false;
      return true;
    })
    .sort((a: any, b: any) => b.createdAt - a.createdAt)[0];
  return auth ?? null;
}

// Find a buyer authorization that references a specific sell offer
export async function fetchBuyerAuthForOffer(offerHash: string): Promise<BuyerAuth | null> {
  const data = await aonGet("/objects?objectType=authorization&namespace=aon:csd-usdc&limit=50");
  const auth = (data.objects ?? []).find((o: any) => {
    const a = o.payload?.authorization;
    return a?.tradeIntentHash?.toLowerCase() === offerHash.toLowerCase();
  });
  return auth ?? null;
}

// ── Receipts ──────────────────────────────────────────────────────────────────

export async function fetchReceipt(authHash: string): Promise<AonReceipt | null> {
  const data = await aonGet(`/objects?objectType=receipt&namespace=aon:csd-usdc&limit=50`);
  const receipt = (data.objects ?? []).find((o: any) =>
    (o.references ?? []).some((r: string) => r.toLowerCase() === authHash.toLowerCase())
  );
  return receipt ?? null;
}

// ── CSD proof ─────────────────────────────────────────────────────────────────

export async function fetchCsdProof(txid: string): Promise<any> {
  const res = await fetch(`${COVENANT_SERVER}/v1/csd/proof/${txid}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? "CSD_PROOF_FETCH_FAILED");
  return data.proof;
}

export async function fetchCsdBalance(scriptPubKey: string): Promise<bigint> {
  try {
    const res = await fetch(`${COVENANT_SERVER}/v1/csd/utxos/${scriptPubKey}`);
    const data = await res.json();
    if (!data.ok) return 0n;
    return BigInt(data.confirmed_balance ?? 0);
  } catch {
    return 0n;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function randomHex32(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")}`;
}

// Convert a 20-byte CSD address (hex) to bytes32 (left-aligned)
export function csdAddrToBytes32(addr: string): `0x${string}` {
  const clean = addr.startsWith("0x") ? addr.slice(2) : addr;
  if (clean.length !== 40) throw new Error("INVALID_CSD_ADDRESS_LENGTH");
  return `0x${clean.padEnd(64, "0")}`;
}

// Format helpers
export function shortHash(h?: string, n = 8) {
  if (!h) return "—";
  return `${h.slice(0, 4 + n)}…${h.slice(-6)}`;
}

export function formatCsd(satoshis: string | bigint | number) {
  try { return (Number(satoshis) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 }); }
  catch { return "0"; }
}

export function formatUsdc(units: string | bigint | number) {
  try { return (Number(units) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 }); }
  catch { return "0"; }
}

export function secondsLeft(ts: string | number) {
  return Math.max(0, Number(ts) - Math.floor(Date.now() / 1000));
}

export function formatCountdown(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}
