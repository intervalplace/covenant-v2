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

const orderTuple = (name: string) => ({
  name, type: "tuple", components: [
    { name: "trader", type: "address" }, { name: "marketId", type: "bytes32" },
    { name: "side", type: "uint8" }, { name: "price", type: "uint256" },
    { name: "baseAmount", type: "uint256" }, { name: "orderNonce", type: "bytes32" },
    { name: "sessionAuthHash", type: "bytes32" }, { name: "validAfter", type: "uint64" },
    { name: "validBefore", type: "uint64" }, { name: "receiveNative", type: "bool" },
    { name: "counterSetHash", type: "bytes32" }, { name: "exclusiveBase", type: "uint256" },
    { name: "exclusiveUntil", type: "uint64" },
  ],
} as const);

const fillTuple = {
  name: "fill", type: "tuple", components: [
    { name: "makerOrderHash", type: "bytes32" }, { name: "takerOrderHash", type: "bytes32" },
    { name: "makerAuthHash", type: "bytes32" }, { name: "takerAuthHash", type: "bytes32" },
    { name: "price", type: "uint256" }, { name: "baseAmount", type: "uint256" },
    { name: "quoteAmount", type: "uint256" }, { name: "executorFeeQuoteAmount", type: "uint256" },
    { name: "fillNonce", type: "bytes32" },
    { name: "makerCounterSet", type: "tuple[]", components: [{ name: "orderHash", type: "bytes32" }, { name: "maxBase", type: "uint256" }] },
    { name: "takerCounterSet", type: "tuple[]", components: [{ name: "orderHash", type: "bytes32" }, { name: "maxBase", type: "uint256" }] },
  ],
} as const;

const err = (name: string, inputs: { name: string; type: string }[] = []) => ({ type: "error", name, inputs } as const);

export const evmSpotSettlementAbi = [
  { type: "event", name: "SpotTradeSettled", anonymous: false, inputs: [
    { indexed: true, name: "fillKey", type: "bytes32" }, { indexed: true, name: "makerOrderHash", type: "bytes32" }, { indexed: true, name: "takerOrderHash", type: "bytes32" },
    { indexed: false, name: "fillNonce", type: "bytes32" }, { indexed: false, name: "makerAuthHash", type: "bytes32" }, { indexed: false, name: "takerAuthHash", type: "bytes32" },
    { indexed: false, name: "maker", type: "address" }, { indexed: false, name: "taker", type: "address" }, { indexed: false, name: "seller", type: "address" },
    { indexed: false, name: "buyer", type: "address" }, { indexed: false, name: "executor", type: "address" }, { indexed: false, name: "baseToken", type: "address" },
    { indexed: false, name: "quoteToken", type: "address" }, { indexed: false, name: "price", type: "uint256" }, { indexed: false, name: "baseAmount", type: "uint256" },
    { indexed: false, name: "quoteAmount", type: "uint256" }, { indexed: false, name: "executorFeeQuoteAmount", type: "uint256" }] },
  { type: "function", name: "settleSpotTrade", stateMutability: "nonpayable",
    inputs: [
      { ...authTuple, name: "makerAuth" }, { name: "makerAuthSig", type: "bytes" },
      orderTuple("makerOrder"), { name: "makerOrderSig", type: "bytes" },
      { ...authTuple, name: "takerAuth" }, { name: "takerAuthSig", type: "bytes" },
      orderTuple("takerOrder"), { name: "takerOrderSig", type: "bytes" },
      fillTuple,
    ], outputs: [] },
  // Errors a self-settle can hit, so wallets and messages can name them
  err("FillReplay", [{ name: "fillNonce", type: "bytes32" }]),
  err("OrderAmountExceeded", [{ name: "orderHash", type: "bytes32" }]),
  err("CounterpartyNotAllowed", [{ name: "orderHash", type: "bytes32" }]),
  err("CounterSetMismatch", [{ name: "orderHash", type: "bytes32" }]),
  err("InvalidPrice"), err("TransferFailed"), err("NativeTransferFailed"), err("ZeroAmount"),
  err("ReservedPartVoid", [{ name: "orderHash", type: "bytes32" }]),
  err("NotEnoughGasForPayout"),
  err("CounterLegExceeded", [{ name: "orderHash", type: "bytes32" }]),
  err("ExecutorFeeTooHigh", [{ name: "authHash", type: "bytes32" }]),
  err("ReceivedLessThanSigned", [{ name: "token", type: "address" }, { name: "recipient", type: "address" }]),
  { type: "function", name: "usedFill", stateMutability: "view",
    inputs: [{ name: "fillKey", type: "bytes32" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "revokeAuthorization", stateMutability: "nonpayable",
    inputs: [authTuple], outputs: [] },
  { type: "function", name: "filledWithCounterparty", stateMutability: "view",
    inputs: [{ name: "orderHash", type: "bytes32" }, { name: "counterHash", type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "boundFilledBase", stateMutability: "view",
    inputs: [{ name: "orderHash", type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "filledBaseByOrder", stateMutability: "view",
    inputs: [{ name: "orderHash", type: "bytes32" }], outputs: [{ type: "uint256" }] },
] as const;
