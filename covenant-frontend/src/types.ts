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
  // Front-running protection: until exclusiveUntil, the first exclusiveBase
  // can only fill against the orders in the counter set, at their prices.
  counterSetHash:  Hex;
  exclusiveBase:   string;
  exclusiveUntil:  string;
};

// A named counterparty of a bound order and the most it may fill against it
export type CounterLeg = { orderHash: Hex; maxBase: bigint };

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
  exclusiveBase:  bigint;      // portion reserved for named counterparties…
  exclusiveUntil: number;      // …until this time (unix seconds)
  boundFilled:    bigint;      // settled against those named counterparties
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
  fillKey:      Hex;           // keccak256(fillNonce, makerOrderHash, takerOrderHash): the contract's replay key
  price:        bigint;
  baseAmount:   bigint;
  quoteAmount:  bigint;
  status:       FillStatus;
  executionTx?: string;
  createdAt:    number;
  settledAt?:   number;
};

export type Log = { ts: number; text: string };
