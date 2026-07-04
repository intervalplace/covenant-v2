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

  // Direct settlement — seller calls this when they have a valid SPV proof,
  // bypassing the executor (e.g. if buyer revoked on AON to block the executor)
  {
    type: "function", name: "settleCsdUsdc", stateMutability: "nonpayable",
    inputs: [
      { name: "auth", type: "tuple", components: [
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
      ]},
      { name: "authSig",  type: "bytes" },
      { name: "spvProof", type: "tuple", components: [
        { name: "txRaw",      type: "bytes" },
        { name: "merkleBranch", type: "tuple[]", components: [
          { name: "hash",   type: "bytes32" },
          { name: "isLeft", type: "bool"    },
        ]},
        { name: "header", type: "tuple", components: [
          { name: "version", type: "uint32"  },
          { name: "prev",    type: "bytes32" },
          { name: "merkle",  type: "bytes32" },
          { name: "time",    type: "uint64"  },
          { name: "bits",    type: "uint32"  },
          { name: "nonce",   type: "uint32"  },
        ]},
        { name: "genesisHash",       type: "bytes32" },
        { name: "confirmationChain", type: "tuple[]", components: [
          { name: "version", type: "uint32"  },
          { name: "prev",    type: "bytes32" },
          { name: "merkle",  type: "bytes32" },
          { name: "time",    type: "uint64"  },
          { name: "bits",    type: "uint32"  },
          { name: "nonce",   type: "uint32"  },
        ]},
      ]},
    ],
    outputs: [],
  },

  // Returns USDC to the buyer after the lock window expires without settlement.
  // Permissionless — anyone can call it, USDC always goes back to auth.buyer.
  {
    type: "function", name: "refundExpiredLock", stateMutability: "nonpayable",
    inputs: [
      { name: "auth", type: "tuple", components: [
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
      ]},
    ],
    outputs: [],
  },
] as const;