// Contract ABIs — minimal surfaces needed by the frontend

export const erc20Abi = [
  { type: "function", name: "balanceOf",  stateMutability: "view",        inputs: [{ name: "account", type: "address" }],                                    outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance",  stateMutability: "view",        inputs: [{ name: "owner",   type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve",    stateMutability: "nonpayable",  inputs: [{ name: "spender", type: "address" }, { name: "amount",  type: "uint256" }], outputs: [{ type: "bool"    }] },
] as const;

// Auth struct for lockCsdUsdcAuthorization and settleCsdUsdc
const authComponents = [
  { name: "buyer",               type: "address"  },
  { name: "sellerUsdcRecipient", type: "address"  },
  { name: "sellerCsdScriptHash", type: "bytes32"  },
  { name: "csdGenesisHash",      type: "bytes32"  },
  { name: "tradeIntentHash",     type: "bytes32"  },
  { name: "csdAmount",           type: "uint256"  },
  { name: "usdc",                type: "address"  },
  { name: "usdcAmount",          type: "uint256"  },
  { name: "minConfirmations",    type: "uint256"  },
  { name: "executorFeeAmount",   type: "uint256"  },
  { name: "validAfter",          type: "uint64"   },
  { name: "validBefore",         type: "uint64"   },
  { name: "nonce",               type: "bytes32"  },
] as const;

export const csdUsdcSettlementAbi = [
  // Lock USDC — called by the SELLER once they're ready to settle
  {
    type: "function", name: "lockCsdUsdcAuthorization", stateMutability: "nonpayable",
    inputs: [
      { name: "auth", type: "tuple", components: authComponents },
      { name: "sig",  type: "bytes"  },
    ],
    outputs: [],
  },

  // Read locked amount for an auth hash
  {
    type: "function", name: "lockedAmount", stateMutability: "view",
    inputs:  [{ name: "authHash", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },

  // Read lock deadline for an auth hash
  {
    type: "function", name: "lockedUntil", stateMutability: "view",
    inputs:  [{ name: "authHash", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },

  // Whether auth is already finalized (settled or consumed)
  {
    type: "function", name: "finalizedAuthorization", stateMutability: "view",
    inputs:  [{ name: "authHash", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
] as const;
