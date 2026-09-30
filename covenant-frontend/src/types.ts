import type { Address, Hex } from "viem";
import type { Market } from "./config";

export type AonObject = {
  objectHash:    string;
  objectType:    string;
  schemaVersion: string;
  namespace:     string;
  createdAt:     number;
  references:    string[];
  payload:       any;
  signature?:    any;
};

// Wire shapes (strings for uints, as stored in AON objects)
export type AuthMessage = {
  grantor:             Address;
  settlementContract:  Address;
  baseToken:           Address;
  quoteToken:          Address;
  marketId:            Hex;
  sideMask:            number;
  maxBaseExposure:     string;
  maxQuoteExposure:    string;
  maxExecutorFeeQuote: string;
  minPrice:            string;
  maxPrice:            string;
  validAfter:          string;
  validBefore:         string;
  authNonce:           Hex;
};

export type OrderMessage = {
  trader:          Address;
  marketId:        Hex;
  side:            number;
  price:           string;
  baseAmount:      string;
  orderNonce:      Hex;
  sessionAuthHash: Hex;
  validAfter:      string;
  validBefore:     string;
  receiveNative:   boolean;  // buy orders on WETH markets: paid out as native ETH
};

export type Side = "buy" | "sell";

// A signed order on AON (may be open, filled, cancelled or expired)
export type RestingOrder = {
  market:       Market;
  side:         Side;          // maker's side
  maker:        Address;
  price:        bigint;        // contract price (quote units per 1e18 base units)
  baseAmount:   bigint;
  filled:       bigint;        // settled on-chain
  pending:      bigint;        // in fills awaiting settlement
  remaining:    bigint;        // still open
  validBefore:  number;        // unix seconds
  createdAt:    number;        // ms
  cancelled:    boolean;
  expired:      boolean;
  feeBudgetLeft: bigint;       // buy orders: executor fee budget left
  funded:       boolean;       // maker's wallet currently covers it
  authObj:      AonObject;
  orderObj:     AonObject;
  orderEip712:  Hex;
};

export type FillStatus = "pending" | "settled" | "stale";

export type FillView = {
  fillHash:     string;
  market:       Market;
  takerSide:    Side;
  maker:        Address;
  taker:        Address;
  makerOrderHash: string;
  takerOrderHash: string;
  fillNonce:    Hex;
  price:        bigint;
  baseAmount:   bigint;
  quoteAmount:  bigint;
  status:       FillStatus;
  executionTx?: string;
  createdAt:    number;
  settledAt?:   number;
};

export type Log = { ts: number; text: string };
