// Covenant config — markets, chain and contract addresses.
//
// Markets are a fixed, preselected list so users never paste a contract
// address. Every market trades on the generic aon:evm-spot namespace and
// settles through one AonEvmSpotSettlement deployment.

import { keccak256, toBytes, type Address, type Hex } from "viem";

export const AON_NODE_URL = process.env.NEXT_PUBLIC_AON_NODE_URL ?? "https://explorer.aon.network";
export const CHAIN_ID     = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 1);
export const NAMESPACE   = "aon:evm-spot";

// AonEvmSpotSettlement (aon-namespace-evm-spot/src/contracts/GenericEvmSpotSettlement.sol)
export const SETTLEMENT_CONTRACT = (process.env.NEXT_PUBLIC_EVM_SPOT_SETTLEMENT ?? "") as Address;

// Demo mode — mocks balances/allowances so the UI works without funds.
// AON object creation is still real.
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

// Executor fee paid by the buyer per fill, in quote-token units (USDT has 6
// decimals, so 100000 = 0.10 USDT). 0 means the Covenant executor settles for free.
export const EXECUTOR_FEE_QUOTE = BigInt(process.env.NEXT_PUBLIC_EXECUTOR_FEE_QUOTE ?? "0");
// A buy order can be filled in many pieces (sweeping levels, then resting);
// its authorization budgets the executor fee for up to this many fills.
export const MAX_FILLS_PER_ORDER = 20n;

// Optional interface-level order size cap, in quote units (0 = no cap).
// Not enforced by the settlement contract. Settlement is atomic, so there is
// no reorg exposure to bound; set this only as a soft limit while unaudited.
export const MAX_ORDER_QUOTE = BigInt(process.env.NEXT_PUBLIC_MAX_ORDER_QUOTE || "0");

// ETH left unwrapped when wrapping for a sell, so the wallet can still pay gas
export const NATIVE_GAS_RESERVE = 10n ** 16n; // 0.01 ETH

// Validity windows
export const MAKER_ORDER_TTL_SECS = 24 * 3600;
export const MARKET_ORDER_TTL_SECS = 15 * 60; // market orders never rest

// ── Tokens ────────────────────────────────────────────────────────────────────

export type Token = {
  symbol:   string;   // what the user sees
  name:     string;
  address:  Address;
  decimals: number;
  wrapsNative?: boolean; // WETH: offer an ETH → WETH wrap
};

const env = (k: string, fallback: string) => (process.env[k] || fallback) as Address;

// Mainnet addresses. Override per token for local/test deployments
// (keep the same decimals when overriding).
export const TOKENS = {
  WETH: { symbol: "ETH",  name: "Wrapped Ether", decimals: 18, wrapsNative: true,
          address: env("NEXT_PUBLIC_WETH_ADDRESS", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2") },
  LINK: { symbol: "LINK", name: "Chainlink",     decimals: 18,
          address: env("NEXT_PUBLIC_LINK_ADDRESS", "0x514910771AF9Ca656af840dff83E8264EcF986CA") },
  QNT:  { symbol: "QNT",  name: "Quant",         decimals: 18,
          address: env("NEXT_PUBLIC_QNT_ADDRESS",  "0x4a220E6096B25EADb88358cb44068A3248254675") },
  USDT: { symbol: "USDT", name: "Tether USD",    decimals: 6,
          address: env("NEXT_PUBLIC_USDT_ADDRESS", "0xdAC17F958D2ee523a2206206994597C13D831ec7") },
} satisfies Record<string, Token>;

// ── Markets ───────────────────────────────────────────────────────────────────

export type Market = {
  key:     string;  // stable UI key, e.g. "ETH-USDT"
  label:   string;  // "ETH / USDT"
  base:    Token;
  quote:   Token;
  marketId: Hex;    // bytes32, deterministic from chain + token addresses
  note?:   string;
};

function marketId(base: Token, quote: Token): Hex {
  return keccak256(toBytes(
    `${NAMESPACE}:${CHAIN_ID}:${base.address.toLowerCase()}:${quote.address.toLowerCase()}`
  ));
}

function market(base: Token, quote: Token, note?: string): Market {
  return {
    key:      `${base.symbol}-${quote.symbol}`,
    label:    `${base.symbol} / ${quote.symbol}`,
    base, quote,
    marketId: marketId(base, quote),
    note,
  };
}

// NOTE: the settlement contract prices in quote-per-base scaled by 1e18 and
// assumes an 18-decimal base token. Only add markets whose base has 18 decimals.
export const MARKETS: Market[] = [
  market(TOKENS.WETH, TOKENS.USDT, "Trade with plain ETH. Buys pay out real ETH; when you sell, any ETH that needs wrapping is wrapped as part of the order."),
  market(TOKENS.LINK, TOKENS.USDT),
  market(TOKENS.QNT,  TOKENS.USDT),
];

export function marketById(id?: string): Market | undefined {
  if (!id) return undefined;
  return MARKETS.find(m => m.marketId.toLowerCase() === id.toLowerCase());
}

// ── EIP-712 ───────────────────────────────────────────────────────────────────
// Must match AonEvmSpotSettlement's constructor and the namespace's type schemas.

export function getEvmSpotDomain() {
  return {
    name:              "AON EVM Spot",
    version:           "1",
    chainId:           CHAIN_ID,
    verifyingContract: (SETTLEMENT_CONTRACT || "0x0000000000000000000000000000000000000001") as Address,
  };
}

export const AUTH_TYPES = {
  TradingSessionAuthorization: [
    { name: "grantor",             type: "address" },
    { name: "settlementContract",  type: "address" },
    { name: "baseToken",           type: "address" },
    { name: "quoteToken",          type: "address" },
    { name: "marketId",            type: "bytes32" },
    { name: "sideMask",            type: "uint8"   },
    { name: "maxBaseExposure",     type: "uint256" },
    { name: "maxQuoteExposure",    type: "uint256" },
    { name: "maxExecutorFeeQuote", type: "uint256" },
    { name: "minPrice",            type: "uint256" },
    { name: "maxPrice",            type: "uint256" },
    { name: "validAfter",          type: "uint64"  },
    { name: "validBefore",         type: "uint64"  },
    { name: "authNonce",           type: "bytes32" },
  ],
} as const;

export const ORDER_TYPES = {
  SignedOrder: [
    { name: "trader",          type: "address" },
    { name: "marketId",        type: "bytes32" },
    { name: "side",            type: "uint8"   },
    { name: "price",           type: "uint256" },
    { name: "baseAmount",      type: "uint256" },
    { name: "orderNonce",      type: "bytes32" },
    { name: "sessionAuthHash", type: "bytes32" },
    { name: "validAfter",      type: "uint64"  },
    { name: "validBefore",     type: "uint64"  },
    { name: "receiveNative",   type: "bool"    },
  ],
} as const;

export const REVOCATION_TYPES = {
  AonRevocation: [
    { name: "targetHash", type: "bytes32" },
    { name: "targetType", type: "string"  },
    { name: "reason",     type: "string"  },
    { name: "nonce",      type: "bytes32" },
  ],
} as const;

// Order sides (contract constants)
export const SIDE_SELL_BASE = 0;
export const SIDE_BUY_BASE  = 1;
// sideMask bits used by _sideAllowed(): buy = 1, sell = 2
export const sideMaskFor = (side: number) => (side === SIDE_BUY_BASE ? 1 : 2);
