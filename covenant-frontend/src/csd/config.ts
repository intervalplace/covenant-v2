// The CSD/USDC market: trades with a market maker, settled by CsdUsdcSettlement
// on Ethereum. The contract and USDC addresses come from the build, never from
// the market maker's API: the USDC permit names the contract as spender.
import type { Address, Hex } from "viem";
import { CHAIN_ID, TOKENS } from "@/config";

export const CSD_MM_URL = (process.env.NEXT_PUBLIC_CSD_MM_URL ?? "").replace(/\/$/, "");
export const CSD_SETTLEMENT = (process.env.NEXT_PUBLIC_CSD_SETTLEMENT ?? "") as Address;
export const CSD_USDC = TOKENS.USDC.address as Address;
export const CSD_GENESIS = (process.env.NEXT_PUBLIC_CSD_GENESIS ?? "0x00000052c2821f71b19c3d79dfabfb12d4076ba15d83b47d008e582aad6c0d52") as Hex;
export const CSD_ENABLED = !!CSD_MM_URL && !!CSD_SETTLEMENT;
// Confirmations the market maker must prove before it is paid for CSD you buy.
// Only it waits; deeper makes a faked payment more expensive.
export const CSD_BUY_CONFIRMATIONS = 6n;
export const CSD_EXPLORER = process.env.NEXT_PUBLIC_CSD_EXPLORER ?? "";

export const csdDomain = () => ({ name: "AON CSD/USDC", version: "4", chainId: CHAIN_ID, verifyingContract: CSD_SETTLEMENT });

export const CSD_AUTH_TYPES = {
  CsdUsdcAuthorization: [
    { name: "buyer",               type: "address" },
    { name: "sellerUsdcRecipient", type: "address" },
    { name: "sellerCsdScriptHash", type: "bytes32" },
    { name: "csdGenesisHash",      type: "bytes32" },
    { name: "tradeIntentHash",     type: "bytes32" },
    { name: "csdAmount",           type: "uint256" },
    { name: "usdc",                type: "address" },
    { name: "usdcAmount",          type: "uint256" },
    { name: "minConfirmations",    type: "uint256" },
    { name: "csdMaxTarget",        type: "uint256" },
    { name: "executorFeeAmount",   type: "uint256" },
    { name: "validAfter",          type: "uint64"  },
    { name: "validBefore",         type: "uint64"  },
    { name: "nonce",               type: "bytes32" },
  ],
} as const;

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner",    type: "address" },
    { name: "spender",  type: "address" },
    { name: "value",    type: "uint256" },
    { name: "nonce",    type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const csdSettlementAbi = [
  { type: "function", name: "usdcLocked",  stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "lockedUntil", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "finalizedAuthorization", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;

export const usdcPermitAbi = [
  { type: "function", name: "nonces",    stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "name",      stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "version",   stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

// What GET /api/market returns
export type CsdMarket = {
  marketMaker: Address; settlement: Address; usdc: Address; chainId: number; csdGenesis: Hex;
  pool: { usdc: string; csd: string }; mid: string; spreadBps: string; feeUsdc: string; bestAsk: string; bestBid: string;
  limits: { minTradeUsdc: string; maxTradeUsdc: string; buyConfirmations: [number, number]; instantRoomUsdc: string };
  csd: { height: number; bits: number; suggestedMaxTarget: string };
  asks: { price: string; csd: string }[]; bids: { price: string; csd: string }[];
  recent: { side: "buy" | "sell"; csdAmount: string; usdcAmount: string; price: string; at: number }[];
};

export async function mmGet<T = any>(path: string): Promise<T> {
  const r = await fetch(`${CSD_MM_URL}/api${path}`, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}
export async function mmPost<T = any>(path: string, body: any): Promise<T> {
  const r = await fetch(`${CSD_MM_URL}/api${path}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_, v) => typeof v === "bigint" ? String(v) : v) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}
