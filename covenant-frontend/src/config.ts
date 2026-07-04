// Contract addresses and chain config — set via environment variables

export const AON_NODE_URL    = process.env.NEXT_PUBLIC_AON_NODE_URL    ?? "https://explorer.aon.network";
export const COVENANT_SERVER = process.env.NEXT_PUBLIC_COVENANT_SERVER ?? "https://server.covenant.trade";
export const CHAIN_ID        = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 1);

// Mainnet contract addresses — populated once deployed
export const SETTLEMENT_CONTRACT  = (process.env.NEXT_PUBLIC_SETTLEMENT_CONTRACT  ?? "") as `0x${string}`;
export const USDC_ADDRESS          = (process.env.NEXT_PUBLIC_USDC_ADDRESS         ?? "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48") as `0x${string}`;

// Real CSD genesis hash
export const CSD_GENESIS_HASH = "0x00000052c2821f71b19c3d79dfabfb12d4076ba15d83b47d008e582aad6c0d52" as `0x${string}`;

// Demo mode — mocks contract reads so the UI works without deployed contracts.
// Set NEXT_PUBLIC_DEMO_MODE=true to enable. AON parts still work for real.
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

// EIP-712 domain for AON CSD/USDC
export function getCsdUsdcDomain() {
  return {
    name:            "AON CSD/USDC",
    version:         "2",
    chainId:         CHAIN_ID,
    verifyingContract: SETTLEMENT_CONTRACT || "0x0000000000000000000000000000000000000001",
  };
}

export const CSD_USDC_TYPES = {
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
    { name: "executorFeeAmount",   type: "uint256" },
    { name: "validAfter",          type: "uint64"  },
    { name: "validBefore",         type: "uint64"  },
    { name: "nonce",               type: "bytes32" },
  ],
} as const;
