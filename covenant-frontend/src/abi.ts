// Minimal contract surfaces used by the frontend.

export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view",       inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view",       inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  // USDT's approve returns nothing; we never read the return value of writes.
  { type: "function", name: "approve",   stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

export const wethAbi = [
  { type: "function", name: "deposit",  stateMutability: "payable",    inputs: [], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const;

const authTuple = {
  name: "auth", type: "tuple", components: [
    { name: "grantor", type: "address" }, { name: "settlementContract", type: "address" },
    { name: "baseToken", type: "address" }, { name: "quoteToken", type: "address" },
    { name: "marketId", type: "bytes32" }, { name: "sideMask", type: "uint8" },
    { name: "maxBaseExposure", type: "uint256" }, { name: "maxQuoteExposure", type: "uint256" },
    { name: "maxExecutorFeeQuote", type: "uint256" }, { name: "minPrice", type: "uint256" },
    { name: "maxPrice", type: "uint256" }, { name: "validAfter", type: "uint64" },
    { name: "validBefore", type: "uint64" }, { name: "authNonce", type: "bytes32" },
  ],
} as const;

export const evmSpotSettlementAbi = [
  { type: "function", name: "usedFillNonce", stateMutability: "view",
    inputs: [{ name: "fillNonce", type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "revokeAuthorization", stateMutability: "nonpayable",
    inputs: [authTuple], outputs: [] },
  { type: "function", name: "filledBaseByOrder", stateMutability: "view",
    inputs: [{ name: "orderHash", type: "bytes32" }], outputs: [{ type: "uint256" }] },
] as const;
