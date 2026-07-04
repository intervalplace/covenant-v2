import type { Address, Hex } from "viem";

// ── AON object shapes ─────────────────────────────────────────────────────────

export type SellOffer = {
  objectHash:   string;
  payload: {
    seller:              Address;
    sellerUsdcRecipient: Address;
    csdGenesisHash:      Hex;
    csdAmount:           string;
    usdcAmount:          string;
    pricePerCsd:         string | null;
    validBefore:         number;
  };
  createdAt: number;
};

export type BuyerAuth = {
  objectHash: string;
  payload: {
    authorization: {
      buyer:               Address;
      sellerUsdcRecipient: Address;
      sellerCsdScriptHash: Hex;
      csdGenesisHash:      Hex;
      tradeIntentHash:     Hex;   // objectHash of the sell offer
      csdAmount:           string;
      usdc:                Address;
      usdcAmount:          string;
      minConfirmations:    string;
      executorFeeAmount:   string;
      validAfter:          string;
      validBefore:         string;
      nonce:               Hex;
    };
  };
  signature: {
    signature: Hex;
    signer:    Address;
    domain:    any;
    types:     any;
    primaryType: string;
    message:   any;
  };
  createdAt: number;
};

export type AonReceipt = {
  objectHash: string;
  payload: {
    executionTx: string;
    verification?: { ok: boolean };
  };
  references: string[];
  createdAt: number;
};

// ── Local UI state shapes ─────────────────────────────────────────────────────

export type TradeMode = "buy" | "sell";

export type SettlementStatus =
  | "none"
  | "auth_pending"    // buyer auth created, waiting for seller to lock
  | "locked"          // USDC locked on-chain
  | "proof_submitted" // proof object on AON, executor settling
  | "settled";        // receipt on AON

export type CompletedTrade = {
  receiptHash:        string;
  authHash:           string;
  csdAmount:          string;   // satoshis
  usdcAmount:         string;   // 6-decimal USDC units
  pricePerCsd:        number;   // USDC per CSD, human-readable
  buyer:              Address;
  sellerUsdcRecipient: Address;
  executionTx:        string;
  timestamp:          number;   // ms
};


export type Log = { ts: number; text: string };
