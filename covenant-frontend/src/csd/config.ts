// The CSD/USDC market: trades with a market maker, settled by CsdUsdcSettlement
// on Ethereum. The contract and USDC addresses come from the build, never from
// the market maker's API: the USDC permit names the contract as spender.
import type { Address, Hex } from "viem";
import { CHAIN_ID, TOKENS } from "@/config";

export const CSD_MM_URL = (process.env.NEXT_PUBLIC_CSD_MM_URL ?? "").replace(/\/$/, "");
export const CSD_SETTLEMENT = (process.env.NEXT_PUBLIC_CSD_SETTLEMENT ?? "") as Address;
export const CSD_USDC = TOKENS.USDC.address as Address;
export const CSD_GENESIS = (process.env.NEXT_PUBLIC_CSD_GENESIS ?? "0x00000052c2821f71b19c3d79dfabfb12d4076ba15d83b47d008e582aad6c0d52") as Hex;
// A CSD node the site trusts independently of the market maker (optional). Used
// to read the current difficulty and to broadcast your payments.
export const CSD_NODE_URL = (process.env.NEXT_PUBLIC_CSD_NODE_URL ?? "").replace(/\/$/, "");
// CSD's difficulty target when this build was made (decimal or 0x hex). The
// difficulty you sign for is never easier than half of it, so a market maker
// can't get you to accept cheaply faked CSD blocks. Rebuild if CSD's
// difficulty falls by more than half.
export const CSD_TARGET_REF = (() => { try { return BigInt(process.env.NEXT_PUBLIC_CSD_TARGET_REF || "0"); } catch { return 0n; } })();
// Market makers this site already knows (optional). Anyone can be one: the page finds every maker's
// signed offers on AON; these only help it find theirs first.
export const CSD_MARKET_MAKERS = (process.env.NEXT_PUBLIC_CSD_MARKET_MAKERS ?? "").split(",").map(s => s.trim()).filter(s => /^0x[0-9a-fA-F]{40}$/.test(s));
export const CSD_ENABLED = !!CSD_MM_URL && !!CSD_SETTLEMENT && (CSD_TARGET_REF > 0n || !!CSD_NODE_URL);
// Confirmations the market maker must prove before it is paid for CSD you buy.
// Only it waits; deeper makes a faked payment more expensive.
export const CSD_BUY_CONFIRMATIONS = 20n;
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

export const csdRefundAbi = [{ type: "function", name: "refundExpiredLock", stateMutability: "nonpayable", outputs: [], inputs: [{ name: "auth", type: "tuple", components: CSD_AUTH_TYPES.CsdUsdcAuthorization }] }] as const;

export const csdSettlementAbi = [
  { type: "function", name: "usdcLocked",  stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "lockedUntil", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "finalizedAuthorization", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "totalLocked", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxTotalLocked", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;
// Locked with every sale for whoever settles it if its maker doesn't release (so a watchtower can, and is paid)
export const CSD_SALE_EXECUTOR_FEE = 1_000_000n;

const CSD_AUTH_COMPONENTS = CSD_AUTH_TYPES.CsdUsdcAuthorization;
const HEADER_COMPONENTS = [
  { name: "version", type: "uint32" }, { name: "prev", type: "bytes32" }, { name: "merkle", type: "bytes32" },
  { name: "time", type: "uint64" }, { name: "bits", type: "uint32" }, { name: "nonce", type: "uint32" },
] as const;
// For claiming a sale yourself with a CSD proof, if the market maker never releases it
export const csdSettleAbi = [{
  type: "function", name: "settleCsdUsdc", stateMutability: "nonpayable", outputs: [],
  inputs: [
    { name: "auth", type: "tuple", components: CSD_AUTH_COMPONENTS },
    { name: "authSig", type: "bytes" },
    { name: "spvProof", type: "tuple", components: [
      { name: "txRaw", type: "bytes" },
      { name: "merkleBranch", type: "tuple[]", components: [{ name: "hash", type: "bytes32" }, { name: "isLeft", type: "bool" }] },
      { name: "header", type: "tuple", components: HEADER_COMPONENTS },
      { name: "confirmationChain", type: "tuple[]", components: HEADER_COMPONENTS },
    ] },
  ],
}] as const;

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
  csd?: { height: number; bits: number; suggestedMaxTarget: string };
  asks: { price: string; csd: string }[]; bids: { price: string; csd: string }[];
  recent: { side: "buy" | "sell"; csdAmount: string; usdcAmount: string; price: string; at: number }[];
  offers?: { sell?: string; buy?: string };
};

export async function mmGet<T = any>(path: string): Promise<T> {
  const r = await fetch(`${CSD_MM_URL}/api${path}`, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}
