"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { useEffect, useState, useCallback } from "react";
import {
  useAccount, useConnect, useDisconnect,
  useReadContract, useReadContracts, useWriteContract, usePublicClient,
  useSignTypedData,
} from "wagmi";
import { injected } from "wagmi/connectors";
import { parseAbi, maxUint256, hashTypedData, type Address, type Hex } from "viem";
import {
  AON_NODE_URL, SETTLEMENT_CONTRACT, USDC_ADDRESS,
  CSD_GENESIS_HASH, getCsdUsdcDomain, CSD_USDC_TYPES, CHAIN_ID, DEMO_MODE,
} from "@/config";
import {
  aonPutObject, fetchSellOffers, fetchBuyerAuthForOffer, fetchMyBuyerAuth,
  fetchReceipt, fetchCsdProof, fetchCsdBalance, fetchCompletedTrades, isAuthorizationRevoked,
  randomHex32, csdAddrToBytes32,
  shortHash, formatCsd, formatUsdc, secondsLeft, formatCountdown,
} from "@/aon";
import { erc20Abi, csdUsdcSettlementAbi } from "@/abi";
import type { SellOffer, BuyerAuth, TradeMode, Log, CompletedTrade } from "@/types";

// Direct import — finalizeObject is pure JS, safe for both SSR and browser
import { finalizeObject as finalizeObj } from "@intervalplace/aon-sdk";

// ── Helpers ───────────────────────────────────────────────────────────────────
function short(x?: string) { return x ? `${x.slice(0, 6)}…${x.slice(-4)}` : ""; }

function toUsdcUnits(x: string) {
  const [whole, frac = ""] = x.trim().split(".");
  return BigInt(whole || "0") * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}

function toCsdSatoshis(x: string) {
  const [whole, frac = ""] = x.trim().split(".");
  return BigInt(whole || "0") * 100_000_000n + BigInt((frac + "00000000").slice(0, 8));
}

function pricePerCsd(csdAmount: string, usdcAmount: string): string {
  try {
    const csd  = Number(csdAmount) / 1e8;
    const usdc = Number(usdcAmount) / 1e6;
    return (usdc / csd).toLocaleString(undefined, { maximumFractionDigits: 6 });
  } catch { return "0"; }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Home() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected, chainId } = useAccount();
  const { connect }    = useConnect();
  const { disconnect } = useDisconnect();
  const { signTypedDataAsync }   = useSignTypedData();
  const { writeContractAsync }   = useWriteContract();
  const publicClient             = usePublicClient();

  // ── UI state ────────────────────────────────────────────────────────────────
  const [mode, setMode]           = useState<TradeMode>("buy");
  const [logs, setLogs]           = useState<Log[]>([]);
  const [status, setStatus]       = useState("");
  const [loading, setLoading]     = useState<string | null>(null);

  // Sell form
  const [csdAmountHuman, setCsdAmountHuman] = useState("5");
  const [usdcPerCsd,     setUsdcPerCsd]     = useState("1");
  const [usdcRecipient,  setUsdcRecipient]  = useState("");
  const [executorFeeUsdc, setExecutorFeeUsdc] = useState("0");

  // My sell offer on AON
  const [mySellOffer, setMySellOffer] = useState<SellOffer | null>(null);
  // Buyer auth matching my offer
  const [matchedAuth, setMatchedAuth]   = useState<BuyerAuth | null>(null);
  const [matchedReserveHash, setMatchedReserveHash] = useState<string | null>(null);

  // Buy form
  const [selectedOffer, setSelectedOffer] = useState<SellOffer | null>(null);
  const [csdReceiveAddr, setCsdReceiveAddr] = useState(""); // 20-byte hex CSD address

  // My buyer auth on AON
  const [myBuyerAuth, setMyBuyerAuth] = useState<BuyerAuth | null>(null);
  // Settlement state
  const [settlementStatus, setSettlementStatus] = useState<"none"|"auth_active"|"locked"|"settled">("none");
  const [lockedAmount,  setLockedAmount]  = useState<bigint>(0n);
  const [lockedUntilTs, setLockedUntilTs] = useState<number>(0);
  const [settledTx,     setSettledTx]     = useState<string>("");

  // Market data
  const [sellBook,       setSellBook]       = useState<SellOffer[]>([]);
  const [completedTrades, setCompletedTrades] = useState<CompletedTrade[]>([]);

  // Seller proof submission
  const [csdTxid, setCsdTxid] = useState("");
  const [revocationDetected, setRevocationDetected] = useState(false);

  // Balances
  const [csdBalance, setCsdBalance] = useState<bigint>(0n);
  const [nodeUnreachable, setNodeUnreachable] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [nowSecs,    setNowSecs]    = useState(Math.floor(Date.now() / 1000));

  const addLog = (text: string) =>
    setLogs(l => [{ ts: Date.now(), text }, ...l].slice(0, 40));

  // Tick every second for countdowns
  useEffect(() => {
    const id = setInterval(() => setNowSecs(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  // Set USDC recipient to connected address by default
  useEffect(() => {
    if (address && !usdcRecipient) setUsdcRecipient(address);
  }, [address]);

  // ── On-chain reads ──────────────────────────────────────────────────────────

  const { data: balanceData } = useReadContracts({
    contracts: address && USDC_ADDRESS && !DEMO_MODE ? [
      { address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf",  args: [address] },
      { address: USDC_ADDRESS, abi: erc20Abi, functionName: "allowance",  args: [address, SETTLEMENT_CONTRACT] },
    ] : [],
    query: { enabled: !!address && !!USDC_ADDRESS && !DEMO_MODE, refetchInterval: 3000 },
  });

  // Demo mode: show 1000 USDC and pre-approved so users can see the full flow
  const usdcBalance   = DEMO_MODE ? 1_000_000_000n : ((balanceData?.[0]?.result as bigint) ?? 0n);
  const usdcAllowance = DEMO_MODE ? 1_000_000_000n : ((balanceData?.[1]?.result as bigint) ?? 0n);

  // ── AON data refresh ─────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    try {
      setNodeUnreachable(false);
      // Sell book + completed trades
      const [offers, trades] = await Promise.all([
        fetchSellOffers(),
        fetchCompletedTrades(),
      ]);
      setCompletedTrades(trades);
      setSellBook(offers.filter(o => o.payload.seller.toLowerCase() !== address?.toLowerCase()));

      // My sell offer
      if (address) {
        const myOffer = offers.find(o =>
          o.payload.seller.toLowerCase() === address.toLowerCase()
        ) ?? null;
        setMySellOffer(myOffer);

        // Buyer auth matching my offer + its reserve (proof must reference reserve)
        if (myOffer) {
          const auth = await fetchBuyerAuthForOffer(myOffer.objectHash);
          setMatchedAuth(auth);
          if (auth) {
            // Find the reserve object that references this auth
            const reserveData = await fetch(
              `${AON_NODE_URL}/v1/objects?objectType=reserve&namespace=aon:csd-usdc&references=${auth.objectHash}&limit=5`
            ).then(r => r.json()).catch(() => ({ objects: [] }));
            const reserve = (reserveData.objects ?? []).find((o: any) =>
              (o.references ?? []).some((r: string) => r.toLowerCase() === auth.objectHash.toLowerCase())
            );
            setMatchedReserveHash(reserve?.objectHash ?? null);
          }
        }

        // My buyer auth
        const buyerAuth = await fetchMyBuyerAuth(address);
        setMyBuyerAuth(buyerAuth);

        // Settlement state from on-chain + receipt
        if (buyerAuth && publicClient) {
          if (DEMO_MODE) {
            // In demo mode: skip on-chain reads, just track auth presence
            if (settlementStatus === "none") setSettlementStatus("auth_active");
          } else if (SETTLEMENT_CONTRACT) {
            // Contract keys by EIP-712 hash of the auth struct, not AON object hash.
            // Compute from the stored signature fields inside the auth object.
            const s = buyerAuth.signature;
            const authEip712Hash = hashTypedData({
              domain:      s.domain,
              types:       s.types,
              primaryType: s.primaryType,
              message:     s.message,
            }) as Hex;
            const [locked, until, finalized] = await Promise.all([
              publicClient.readContract({ address: SETTLEMENT_CONTRACT, abi: csdUsdcSettlementAbi, functionName: "lockedAmount",  args: [authEip712Hash] }).catch(() => 0n),
              publicClient.readContract({ address: SETTLEMENT_CONTRACT, abi: csdUsdcSettlementAbi, functionName: "lockedUntil",   args: [authEip712Hash] }).catch(() => 0n),
              publicClient.readContract({ address: SETTLEMENT_CONTRACT, abi: csdUsdcSettlementAbi, functionName: "finalizedAuthorization", args: [authEip712Hash] }).catch(() => false),
            ]) as [bigint, bigint, boolean];

            setLockedAmount(locked);
            setLockedUntilTs(Number(until));

            if (finalized) {
              setSettlementStatus("settled");
              const receipt = await fetchReceipt(buyerAuth.objectHash);
              if (receipt?.payload?.executionTx) setSettledTx(receipt.payload.executionTx);
            } else if (locked > 0n) {
              setSettlementStatus("locked");
              // Check if buyer revoked on AON — seller must settle directly
              const revoked = await isAuthorizationRevoked(buyerAuth.objectHash);
              setRevocationDetected(revoked);
            } else if (buyerAuth) {
              setSettlementStatus("auth_active");
            }
          }
        }
      }
    } catch (err: any) {
      console.error("refresh error", err);
      if (err?.message?.includes("fetch") || err?.message?.includes("network") || err?.message?.includes("ECONNREFUSED")) {
        setNodeUnreachable(true);
      }
    } finally {
      setInitialLoadDone(true);
    }
  }, [address, publicClient]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  // CSD balance
  useEffect(() => {
    if (!csdReceiveAddr) return;
    fetchCsdBalance(csdReceiveAddr).then(setCsdBalance).catch(() => {});
  }, [csdReceiveAddr]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function createSellOffer() {
    if (!address || !finalizeObj) return;
    const csdSats = toCsdSatoshis(csdAmountHuman);
    const usdcUnits = toUsdcUnits((Number(csdAmountHuman) * Number(usdcPerCsd)).toFixed(6));
    const execFeeUnits = toUsdcUnits(executorFeeUsdc || "0");
    if (usdcUnits + execFeeUnits > 100_000_000n) {
      setStatus("Total USDC (trade + executor fee) cannot exceed 100 USDC. This limit is enforced by the settlement contract.");
      return;
    }
    const validBefore = Math.floor(Date.now() / 1000) + 86400; // 24h

    const obj = finalizeObj({
      objectType: "csd_sell_offer", schemaVersion: "1", namespace: "aon:csd-usdc",
      createdAt: Date.now(), references: [],
      payload: {
        offerType:           "csd_usdc_sell",
        seller:              address,
        sellerUsdcRecipient: usdcRecipient || address,
        csdGenesisHash:      CSD_GENESIS_HASH,
        csdAmount:           csdSats.toString(),
        usdcAmount:          usdcUnits.toString(),
        pricePerCsd:         usdcPerCsd,
        executorFeeAmount:   toUsdcUnits(executorFeeUsdc || "0").toString(),
        validBefore,
      },
    } as any);

    setLoading("Creating sell offer...");
    try {
      const res = await aonPutObject(obj);
      setMySellOffer({ objectHash: res.objectHash, payload: obj.payload as any, createdAt: obj.createdAt });
      setStatus("Sell offer created. Waiting for a buyer.");
      addLog(`Sell offer: ${res.objectHash}`);
    } finally { setLoading(null); }
  }

  async function approveUsdc() {
    if (!address) return;
    if (DEMO_MODE) { setStatus("Demo mode: USDC pre-approved."); return; }
    setLoading("Approving USDC...");
    try {
      setLoading("Approving USDC...");
      const approveTx = await writeContractAsync({
        address: USDC_ADDRESS, abi: erc20Abi,
        functionName: "approve",
        args: [SETTLEMENT_CONTRACT, maxUint256],
      });
      setLoading("Waiting for confirmation...");
      await publicClient?.waitForTransactionReceipt({ hash: approveTx });
      addLog("USDC approved.");
      setStatus("USDC approved. You can now authorize the trade.");
    } finally { setLoading(null); }
  }

  async function authorizeBuy() {
    if (!address || !selectedOffer || !finalizeObj) return;
    if (!csdReceiveAddr || !/^0x[0-9a-fA-F]{40}$/.test(csdReceiveAddr.trim())) {
      setStatus("Enter a valid 20-byte CSD receive address (0x + 40 hex chars).");
      return;
    }

    const now          = Math.floor(Date.now() / 1000);
    const usdcAmount   = BigInt(selectedOffer.payload.usdcAmount);
    const csdAmount    = BigInt(selectedOffer.payload.csdAmount);
    const scriptHash32 = csdAddrToBytes32(csdReceiveAddr.trim());

    const authMessage = {
      buyer:               address,
      sellerUsdcRecipient: selectedOffer.payload.sellerUsdcRecipient,
      sellerCsdScriptHash: scriptHash32,
      csdGenesisHash:      CSD_GENESIS_HASH,
      tradeIntentHash:     selectedOffer.objectHash as Hex, // binds auth to this offer
      csdAmount:           csdAmount,
      usdc:                USDC_ADDRESS,
      usdcAmount:          usdcAmount,
      minConfirmations:    1n,
      executorFeeAmount:   BigInt(selectedOffer?.payload?.executorFeeAmount ?? 0),
      validAfter:          BigInt(now - 60),
      validBefore:         BigInt(now + 3600),
      nonce:               randomHex32(),
    };

    setLoading("Sign authorization in wallet...");
    try {
      const sig = await signTypedDataAsync({
        domain:      getCsdUsdcDomain(),
        types:       CSD_USDC_TYPES,
        primaryType: "CsdUsdcAuthorization",
        message:     authMessage,
      });

      // Normalize message for AON object (string values)
      const authForPayload = {
        ...authMessage,
        csdAmount:           authMessage.csdAmount.toString(),
        usdcAmount:          authMessage.usdcAmount.toString(),
        minConfirmations:    authMessage.minConfirmations.toString(),
        executorFeeAmount:   authMessage.executorFeeAmount.toString(),
        validAfter:          authMessage.validAfter.toString(),
        validBefore:         authMessage.validBefore.toString(),
      };

      const domain = getCsdUsdcDomain();

      const authObj = finalizeObj({
        objectType: "authorization", schemaVersion: "1", namespace: "aon:csd-usdc",
        createdAt: Date.now(), references: [],
        payload: { authorizationType: "csd_usdc_release", authorization: authForPayload },
        signature: {
          scheme: "eip712", signer: address, domain,
          types: CSD_USDC_TYPES, primaryType: "CsdUsdcAuthorization",
          message: authForPayload, signature: sig,
        },
      } as any);

      const reserveObj = finalizeObj({
        objectType: "reserve", schemaVersion: "1", namespace: "aon:csd-usdc",
        createdAt: Date.now(), references: [authObj.objectHash],
        payload: { reserveType: "csd_usdc_intent" },
      } as any);

      await aonPutObject(authObj);
      await aonPutObject(reserveObj);

      addLog(`Authorization: ${authObj.objectHash}`);
      addLog(`Reserve: ${reserveObj.objectHash}`);
      setStatus("Authorization created. Waiting for seller to lock settlement.");
      setSettlementStatus("auth_active");
      await refresh();
    } finally { setLoading(null); }
  }

  async function cancelSellOffer() {
    if (!mySellOffer || !finalizeObj) return;
    setLoading("Cancelling offer...");
    try {
      const revocation = finalizeObj({
        objectType: "revocation", schemaVersion: "1", namespace: "aon:csd-usdc",
        createdAt: Date.now(), references: [mySellOffer.objectHash],
        payload: { reason: "seller_cancelled" },
      } as any);
      await aonPutObject(revocation);
      setMySellOffer(null);
      setStatus("Sell offer cancelled.");
      addLog(`Offer cancelled: ${mySellOffer.objectHash}`);
    } finally { setLoading(null); }
  }

  // Seller locks USDC — called by seller once they're ready to send CSD
  async function lockSettlement() {
    if (!matchedAuth || !address) return;

    if (DEMO_MODE) {
      // Simulate lock in demo mode
      setLockedAmount(BigInt(matchedAuth.payload.authorization.usdcAmount));
      setLockedUntilTs(Math.floor(Date.now() / 1000) + 600);
      setSettlementStatus("locked");
      addLog("Demo: USDC lock simulated.");
      setStatus("Demo mode: USDC locked. Send CSD and submit txid.");
      return;
    }

    const a = matchedAuth.payload.authorization;
    const authTuple = {
      buyer:               a.buyer,
      sellerUsdcRecipient: a.sellerUsdcRecipient,
      sellerCsdScriptHash: a.sellerCsdScriptHash as Hex,
      csdGenesisHash:      a.csdGenesisHash as Hex,
      tradeIntentHash:     a.tradeIntentHash as Hex,
      csdAmount:           BigInt(a.csdAmount),
      usdc:                a.usdc,
      usdcAmount:          BigInt(a.usdcAmount),
      minConfirmations:    BigInt(a.minConfirmations),
      executorFeeAmount:   BigInt(a.executorFeeAmount ?? 0),
      validAfter:          BigInt(a.validAfter),
      validBefore:         BigInt(a.validBefore),
      nonce:               a.nonce as Hex,
    };

    setLoading("Locking USDC...");
    try {
      setLoading("Locking USDC...");
      const lockHash = await writeContractAsync({
        address: SETTLEMENT_CONTRACT, abi: csdUsdcSettlementAbi,
        functionName: "lockCsdUsdcAuthorization",
        args: [authTuple, matchedAuth.signature.signature],
      });
      setLoading("Waiting for confirmation...");
      await publicClient?.waitForTransactionReceipt({ hash: lockHash });
      addLog(`Lock tx: ${lockHash}`);
      setStatus("USDC locked. You can now safely send CSD to the buyer's address.");
      await refresh();
    } finally { setLoading(null); }
  }

  // Claims refund of expired USDC lock back to buyer.
  // Permissionless — anyone can call after the window expires.
  async function claimRefund() {
    const auth = myBuyerAuth ?? matchedAuth;
    if (!auth) return;
    const a = auth.payload.authorization;

    const authTuple = {
      buyer:               a.buyer,
      sellerUsdcRecipient: a.sellerUsdcRecipient,
      sellerCsdScriptHash: a.sellerCsdScriptHash as Hex,
      csdGenesisHash:      a.csdGenesisHash as Hex,
      tradeIntentHash:     a.tradeIntentHash as Hex,
      csdAmount:           BigInt(a.csdAmount),
      usdc:                a.usdc,
      usdcAmount:          BigInt(a.usdcAmount),
      minConfirmations:    BigInt(a.minConfirmations),
      executorFeeAmount:   BigInt(a.executorFeeAmount ?? 0),
      validAfter:          BigInt(a.validAfter),
      validBefore:         BigInt(a.validBefore),
      nonce:               a.nonce as Hex,
    };

    setLoading("Refunding USDC to buyer...");
    try {
      const tx = await writeContractAsync({
        address: SETTLEMENT_CONTRACT,
        abi: csdUsdcSettlementAbi,
        functionName: "refundExpiredLock",
        args: [authTuple],
      });
      addLog(`Refund tx: ${tx}`);
      setStatus("Refund submitted. USDC is returning to buyer.");
      await refresh();
    } catch (err: any) {
      setStatus(`Refund error: ${(err?.shortMessage ?? err?.message ?? "").slice(0, 120)}`);
    } finally { setLoading(null); }
  }

  // Seller calls settleCsdUsdc directly — used when buyer revoked on AON
  // to block the executor. The contract only checks the SPV proof, not revocations.
  async function settleDirectly() {
    if (!csdTxid || !matchedAuth || !finalizeObj) return;
    const a = matchedAuth.payload.authorization;

    setLoading("Fetching CSD proof...");
    try {
      const proof = await fetchCsdProof(csdTxid.trim());
      addLog(`CSD proof: ${proof.confirmations} confirmation(s)`);

      const authTuple = {
        buyer:               a.buyer,
        sellerUsdcRecipient: a.sellerUsdcRecipient,
        sellerCsdScriptHash: a.sellerCsdScriptHash as Hex,
        csdGenesisHash:      a.csdGenesisHash as Hex,
        tradeIntentHash:     a.tradeIntentHash as Hex,
        csdAmount:           BigInt(a.csdAmount),
        usdc:                a.usdc,
        usdcAmount:          BigInt(a.usdcAmount),
        minConfirmations:    BigInt(a.minConfirmations),
        executorFeeAmount:   BigInt(a.executorFeeAmount ?? 0),
        validAfter:          BigInt(a.validAfter),
        validBefore:         BigInt(a.validBefore),
        nonce:               a.nonce as Hex,
      };

      const spvProof = {
        txRaw:       proof.tx_raw as Hex,
        merkleBranch: (proof.merkle_branch ?? []).map((step: any) => ({
          hash:   step.hash as Hex,
          isLeft: step.position === "left" || step.isLeft === true,
        })),
        header: {
          version: Number(proof.header.version),
          prev:    proof.header.prev as Hex,
          merkle:  proof.header.merkle as Hex,
          time:    BigInt(proof.header.time),
          bits:    Number(proof.header.bits),
          nonce:   Number(proof.header.nonce),
        },
        genesisHash:       proof.genesis_hash as Hex,
        confirmationChain: (proof.confirmation_chain ?? []).map((h: any) => ({
          version: Number(h.version),
          prev:    h.prev as Hex,
          merkle:  h.merkle as Hex,
          time:    BigInt(h.time),
          bits:    Number(h.bits),
          nonce:   Number(h.nonce),
        })),
      };

      setLoading("Submitting settlement tx from your wallet...");
      const tx = await writeContractAsync({
        address: SETTLEMENT_CONTRACT,
        abi: csdUsdcSettlementAbi,
        functionName: "settleCsdUsdc",
        args: [authTuple, matchedAuth.signature.signature as Hex, spvProof],
      });
      addLog(`Direct settlement tx: ${tx}`);
      setStatus("Settlement submitted directly. USDC will release once confirmed.");
      await refresh();
    } catch (err: any) {
      const msg = err?.message ?? "Unknown error";
      if (msg.includes("NOT_FOUND") || msg.includes("404")) {
        setStatus("CSD transaction not found yet. Wait for it to be mined.");
      } else {
        setStatus(`Error: ${msg.slice(0, 120)}`);
      }
    } finally { setLoading(null); }
  }

  // Seller submits CSD txid — creates proof object on AON
  async function submitCsdProof() {
    if (!csdTxid || !matchedAuth || !finalizeObj) return;

    const a = matchedAuth.payload.authorization;
    setLoading("Fetching CSD proof...");
    try {
      const proof = await fetchCsdProof(csdTxid.trim());
      addLog(`CSD proof: ${proof.confirmations} confirmations`);

      // Proof must reference the RESERVE (not the auth) — executor walks proof→reserve→auth
      const proofRef = matchedReserveHash ?? matchedAuth.objectHash;
      const proofObj = finalizeObj({
        objectType: "proof", schemaVersion: "1", namespace: "aon:csd-usdc",
        createdAt: Date.now(), references: [proofRef],
        payload: {
          proofType: "csd_payment",
          txid: csdTxid.trim(),
          proof,
          expectedRecipientScriptPubKey: a.sellerCsdScriptHash,
          expectedAmount: a.csdAmount,
          minConfirmations: Number(a.minConfirmations),
        },
      } as any);

      await aonPutObject(proofObj);
      addLog(`Proof object: ${proofObj.objectHash}`);
      setStatus("Proof submitted. The executor is settling and USDC will release shortly.");
      await refresh();
    } catch (err: any) {
      const msg = err?.message ?? "Unknown error";
      if (msg.includes("NOT_FOUND")) setStatus("CSD transaction not found yet. Wait for it to be mined.");
      else if (msg.includes("CONFIRMATIONS")) setStatus("Not enough confirmations yet. Wait for the next CSD block.");
      else setStatus(`Proof error: ${msg}`);
    } finally { setLoading(null); }
  }

  if (!mounted) return null;

  const isWrongChain = isConnected && chainId !== CHAIN_ID;
  const windowRemaining = lockedUntilTs > 0 ? Math.max(0, lockedUntilTs - nowSecs) : 0;
  const buyerCsdAddr = myBuyerAuth?.payload?.authorization?.sellerCsdScriptHash
    ? "0x" + myBuyerAuth.payload.authorization.sellerCsdScriptHash.slice(2, 42)
    : null;

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 20px 80px" }}>

      {/* Header */}
      <header style={{ marginBottom: 56 }}>
        <div className="page-header">
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600 }}>Covenant</div>
            <h1 style={{ fontSize: 44, lineHeight: 1.1, margin: "12px 0 0", maxWidth: 700 }}>
              Execution no longer requires trust.
            </h1>
            <p className="muted" style={{ marginTop: 12, maxWidth: 600, fontSize: 17 }}>
              CSD/USDC settlement. Trustless, on-chain SPV verified.
            </p>
          </div>
          <div className="page-header-right">
            <div className="row">
              {isConnected ? (
                <>
                  <span className="muted" style={{ fontSize: 14 }}>{short(address)}</span>
                  {isWrongChain && <span className="tag tag-red">Wrong network</span>}
                  <button className="btn-secondary" style={{ fontSize: 13, padding: "7px 14px" }} onClick={() => disconnect()}>
                    Disconnect
                  </button>
                </>
              ) : (
                <button className="btn" onClick={() => connect({ connector: injected() })}>
                  Connect wallet
                </button>
              )}
            </div>
            <a
              href={`https://explorer.aon.network`}
              target="_blank" rel="noreferrer"
              className="muted"
              style={{ fontSize: 12 }}
            >
              AON Explorer ↗
            </a>
          </div>
        </div>
      </header>

      {/* Demo mode banner */}
      {DEMO_MODE && (
        <div style={{
          background: "rgba(154,104,0,0.07)", border: "1px solid rgba(255,214,102,0.25)",
          borderRadius: 8, padding: "10px 16px", marginBottom: 18,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span className="warn" style={{ fontSize: 13, fontWeight: 500 }}>DEMO MODE</span>
          <span className="muted" style={{ fontSize: 13 }}>
            USDC balances and contract calls are simulated. AON object creation is real.
          </span>
        </div>
      )}

      {/* Node unreachable banner */}
      {nodeUnreachable && (
        <div style={{
          background: "rgba(192,57,43,0.06)", border: "1px solid rgba(192,57,43,0.2)",
          borderRadius: 5, padding: "10px 16px", marginBottom: 18,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span className="danger" style={{ fontSize: 13, fontWeight: 500 }}>Cannot reach AON node</span>
          <span className="muted" style={{ fontSize: 13 }}>
            Retrying automatically. The network may be temporarily unavailable.
          </span>
        </div>
      )}

      {/* Status banner */}
      {status && (
        <div className="card" style={{ marginBottom: 18, borderColor: "rgba(26,102,64,0.10)" }}>
          <div className="faint">Status</div>
          <div style={{ marginTop: 8, fontSize: 17 }}>{status}</div>
        </div>
      )}

      {/* Market header */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="row-between">
          <div>
            <div className="faint">Market</div>
            <div style={{ fontSize: 20, marginTop: 6 }}>CSD / USDC</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button
              className={mode === "buy" ? "btn" : "btn-secondary"}
              onClick={() => setMode("buy")}
            >Buy CSD</button>
            <button
              className={mode === "sell" ? "btn" : "btn-secondary"}
              onClick={() => setMode("sell")}
            >Sell CSD</button>
          </div>
        </div>
      </div>

      <div className="market-grid">

        {/* Sell book */}
        <div className="col">
          <div className="card">
            <div className="faint" style={{ marginBottom: 14 }}>Sell book</div>
            {nodeUnreachable ? (
              <div className="muted" style={{ fontSize: 13 }}>Cannot reach network.</div>
            ) : !initialLoadDone ? (
              <div className="muted">Loading...</div>
            ) : sellBook.length === 0 ? (
              <div className="muted">No open sell offers.</div>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                {sellBook.map(offer => (
                  <div
                    key={offer.objectHash}
                    className="card-inner"
                    onClick={() => mode === "buy" && setSelectedOffer(offer)}
                    style={{
                      cursor: mode === "buy" ? "pointer" : "default",
                      borderColor: selectedOffer?.objectHash === offer.objectHash
                        ? "rgba(26,102,64,0.22)"
                        : undefined,
                    }}
                  >
                    <div className="row-between">
                      <div>
                        <div style={{ fontSize: 18 }}>{formatCsd(offer.payload.csdAmount)} CSD</div>
                        <div className="muted" style={{ fontSize: 14, marginTop: 3 }}>
                          {formatUsdc(offer.payload.usdcAmount)} USDC
                          {offer.payload.pricePerCsd && ` · ${offer.payload.pricePerCsd} USDC/CSD`}
                          {Number(offer.payload.executorFeeAmount ?? 0) > 0 && (
                            <span> · +{formatUsdc(offer.payload.executorFeeAmount)} executor fee</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                        {mode === "buy" && (
                          <button
                            className="btn-accent"
                            style={{ fontSize: 13, padding: "4px 12px" }}
                            onClick={(e) => { e.stopPropagation(); setSelectedOffer(offer); }}
                          >
                            Select
                          </button>
                        )}
                        {(() => {
                          const secs = secondsLeft(offer.payload.validBefore);
                          const urgent = secs < 3600;
                          return (
                            <span style={{ fontSize: 12, color: urgent ? "var(--warn)" : "var(--muted)" }}>
                              {urgent ? "expires " : ""}{formatCountdown(secs)}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="mono faint" style={{ marginTop: 8 }}>
                      {shortHash(offer.objectHash)} ·{" "}
                      <a
                        href={`https://explorer.aon.network?hash=${offer.objectHash}`}
                        target="_blank" rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{ color: "inherit" }}
                      >
                        view on AON ↗
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Trade panel */}
        <div className="col">

          {/* ── BUY PANEL ── */}
          {mode === "buy" && (
            <div className="card grid">
              <div>
                <div className="faint" style={{ marginBottom: 8 }}>Buy CSD</div>
                <h2 style={{ margin: 0 }}>
                  {selectedOffer
                    ? `${formatCsd(selectedOffer.payload.csdAmount)} CSD for ${formatUsdc(selectedOffer.payload.usdcAmount)} USDC`
                    : "Select a sell offer"}
                </h2>
              </div>

              {!selectedOffer ? (
                <div className="muted">Choose an offer from the sell book to continue.</div>
              ) : settlementStatus === "settled" ? (
                <div className="card-inner" style={{ borderColor: "rgba(26,102,64,0.18)" }}>
                  <div className="faint">Settled</div>
                  <div className="accent" style={{ fontSize: 20, marginTop: 8 }}>CSD payment verified. USDC released.</div>
                  {settledTx && (
                    <div className="mono faint" style={{ marginTop: 10 }}>
                      <a href={`https://etherscan.io/tx/${settledTx}`} target="_blank" rel="noreferrer">
                        View settlement tx ↗
                      </a>
                    </div>
                  )}
                </div>
              ) : myBuyerAuth ? (
                // Already have an active authorization
                <div className="col">
                  <div className="card-inner">
                    <div className="faint">Your authorization</div>
                    <a href={`https://explorer.aon.network?hash=${myBuyerAuth.objectHash}`} target="_blank" rel="noreferrer" className="mono" style={{ marginTop: 8, fontSize: 12, display: "block" }}>{myBuyerAuth.objectHash}</a>
                    {buyerCsdAddr && (
                      <>
                        <div className="muted" style={{ marginTop: 12, fontSize: 13 }}>
                          Your CSD receive address:
                        </div>
                        <div className="mono" style={{ marginTop: 4 }}>{buyerCsdAddr}</div>
                        <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                          The seller must send CSD to this address.
                        </div>
                      </>
                    )}
                  </div>

                  {settlementStatus === "locked" && (
                    <div className="card-inner" style={{ borderColor: "rgba(26,102,64,0.18)" }}>
                      <div className="faint">Settlement window</div>
                      <div style={{ marginTop: 10, fontSize: 13, color: "var(--muted)" }}>
                        {formatUsdc(lockedAmount.toString())} USDC reserved
                      </div>
                      {windowRemaining > 0 ? (
                        <div style={{ marginTop: 14, display: "flex", alignItems: "baseline", gap: 8 }}>
                          <span style={{ fontSize: 36, lineHeight: 1 }}>
                            {formatCountdown(windowRemaining)}
                          </span>
                          <span className="muted" style={{ fontSize: 13 }}>remaining</span>
                        </div>
                      ) : (
                        <div className="warn" style={{ marginTop: 10, fontSize: 14 }}>
                          Window expired. Awaiting refund.
                        </div>
                      )}
                      <div className="muted" style={{ marginTop: 12, fontSize: 13 }}>
                        Seller is sending CSD. Settlement releases your USDC automatically once the proof is verified on-chain.
                      </div>
                    </div>
                  )}

                  {settlementStatus === "auth_active" && (() => {
                    const expiresIn = secondsLeft(myBuyerAuth!.payload.authorization.validBefore);
                    const urgent = expiresIn < 600;
                    const expired = expiresIn === 0;
                    return expired ? (
                      <div className="card-inner">
                        <div className="warn" style={{ fontWeight: 500, marginBottom: 8 }}>Authorization expired</div>
                        <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                          The seller did not lock USDC before your authorization expired. Create a new one to try again.
                        </div>
                        <button className="btn" onClick={() => {
                          setMyBuyerAuth(null);
                          setSettlementStatus("none");
                          setSelectedOffer(null);
                        }}>
                          Start over
                        </button>
                      </div>
                    ) : (
                      <div className="card-inner">
                        <div className="faint">Authorization expires in</div>
                        <div style={{ marginTop: 14, display: "flex", alignItems: "baseline", gap: 8 }}>
                          <span style={{
                            fontSize: 36, lineHeight: 1,
                            color: urgent ? "var(--warn)" : "var(--fg)",
                          }}>
                            {formatCountdown(expiresIn)}
                          </span>
                        </div>
                        <div className="muted" style={{ marginTop: 12, fontSize: 13 }}>
                          Waiting for seller to lock USDC.
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                // No auth yet — show buy form
                <div className="col">
                  {!initialLoadDone && isConnected && (
                    <div className="muted" style={{ fontSize: 13 }}>Checking your active trades...</div>
                  )}
                  <div className="card-inner" style={{ borderColor: "rgba(154,104,0,0.10)" }}>
                    <div className="faint">Trade limit</div>
                    <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                      Maximum 100 USDC per trade. This limit is enforced by the settlement contract
                      to bound risk on 1-confirmation CSD settlement.
                    </div>
                  </div>
                  <div>
                    <label>Your CSD receive address (0x + 40 hex)</label>
                    <input
                      value={csdReceiveAddr}
                      onChange={e => setCsdReceiveAddr(e.target.value)}
                      placeholder="0xabcdef..."
                    />
                    {csdBalance > 0n && (
                      <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                        Balance at this address: {formatCsd(csdBalance)} CSD
                      </div>
                    )}
                  </div>

                  <div className="card-inner">
                    {(() => {
                      const tradeUsdc = BigInt(selectedOffer.payload.usdcAmount);
                      const execFee   = BigInt(selectedOffer.payload.executorFeeAmount ?? 0);
                      const totalUsdc = tradeUsdc + execFee;
                      const sufficient = usdcAllowance >= totalUsdc;
                      return (
                        <>
                          <div className="row-between">
                            <span className="muted">Trade amount</span>
                            <span>{formatUsdc(tradeUsdc.toString())} USDC</span>
                          </div>
                          {execFee > 0n && (
                            <div className="row-between" style={{ marginTop: 6 }}>
                              <span className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                Executor fee
                                <span style={{ fontSize: 11, color: "var(--faint)", fontStyle: "italic" }}>set by seller</span>
                              </span>
                              <span className="muted">{formatUsdc(execFee.toString())} USDC</span>
                            </div>
                          )}
                          <div className="row-between" style={{
                            marginTop: execFee > 0n ? 8 : 4,
                            paddingTop: execFee > 0n ? 8 : 0,
                            borderTop: execFee > 0n ? "1px solid var(--border)" : "none",
                            fontWeight: 500,
                          }}>
                            <span className="muted">Total you pay</span>
                            <span>{formatUsdc(totalUsdc.toString())} USDC</span>
                          </div>
                          <div className="row-between" style={{ marginTop: 8 }}>
                            <span className="muted">USDC balance</span>
                            <span>{formatUsdc(usdcBalance)} USDC</span>
                          </div>
                          <div className="row-between" style={{ marginTop: 6 }}>
                            <span className="muted">USDC approved</span>
                            <span className={sufficient ? "accent" : "warn"}>
                              {sufficient ? "✓ sufficient" : "insufficient"}
                            </span>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {usdcAllowance < BigInt(selectedOffer.payload.usdcAmount) + BigInt(selectedOffer.payload.executorFeeAmount ?? 0) ? (
                    <button
                      className="btn"
                      onClick={approveUsdc}
                      disabled={!isConnected || !!loading}
                    >
                      {loading ?? "Approve USDC"}
                    </button>
                  ) : BigInt(selectedOffer.payload.usdcAmount) + BigInt(selectedOffer.payload.executorFeeAmount ?? 0) > 100_000_000n ? (
                    <div className="card-inner" style={{ borderColor: "rgba(192,57,43,0.18)" }}>
                      <div className="danger" style={{ fontSize: 14 }}>
                        This offer exceeds the 100 USDC contract limit and cannot be settled.
                        Contact the seller to split into smaller trades.
                      </div>
                    </div>
                  ) : (
                    <button
                      className="btn"
                      onClick={authorizeBuy}
                      disabled={!isConnected || !!loading || !csdReceiveAddr}
                    >
                      {loading ?? "Authorize buy"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── SELL PANEL ── */}
          {mode === "sell" && (
            <div className="card grid">
              <div>
                <div className="faint" style={{ marginBottom: 8 }}>Sell CSD</div>
              </div>

              {!mySellOffer ? (
                // Create sell offer form
                <div className="col">
                  <div className="card-inner" style={{ borderColor: "rgba(154,104,0,0.10)" }}>
                    <div className="faint">Trade limit</div>
                    <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                      Maximum 100 USDC per trade, enforced by the settlement contract.
                    </div>
                  </div>
                  <div>
                    <label>CSD amount</label>
                    <input value={csdAmountHuman} onChange={e => setCsdAmountHuman(e.target.value)} />
                  </div>
                  <div>
                    <label>USDC per CSD</label>
                    <input value={usdcPerCsd} onChange={e => setUsdcPerCsd(e.target.value)} />
                  </div>
                  <div>
                    <label>Your USDC recipient</label>
                    <input value={usdcRecipient} onChange={e => setUsdcRecipient(e.target.value)} placeholder={address ?? "0x..."} />
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
                      <label style={{ margin: 0 }}>Executor fee (USDC)</label>
                      <span className="muted" style={{ fontSize: 12 }}>paid by buyer to whoever settles the trade on-chain</span>
                    </div>
                    <input
                      value={executorFeeUsdc}
                      onChange={e => setExecutorFeeUsdc(e.target.value)}
                      placeholder="0"
                    />
                    <div className="muted" style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6 }}>
                      The executor is software that submits the settlement transaction on Ethereum.
                      A non-zero fee incentivizes third parties to run executors and settle trades faster.
                      Set to 0 if you are running your own executor or do not need fast settlement.
                    </div>
                  </div>
                  <div className="card-inner">
                    <div className="row-between" style={{ marginBottom: 6 }}>
                      <span className="muted">Buyer pays</span>
                      <span style={{ fontSize: 18 }}>
                        {(Number(csdAmountHuman) * Number(usdcPerCsd) + Number(executorFeeUsdc || 0)).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC
                      </span>
                    </div>
                    <div className="row-between" style={{ fontSize: 13 }}>
                      <span className="muted">You receive</span>
                      <span className="muted">{(Number(csdAmountHuman) * Number(usdcPerCsd)).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC</span>
                    </div>
                    {Number(executorFeeUsdc) > 0 && (
                      <div className="row-between" style={{ fontSize: 13, marginTop: 2 }}>
                        <span className="muted">Executor receives</span>
                        <span className="muted">{Number(executorFeeUsdc).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC</span>
                      </div>
                    )}
                  </div>
                  <button
                    className="btn"
                    onClick={createSellOffer}
                    disabled={!isConnected || !!loading}
                  >
                    {loading ?? "Create sell offer"}
                  </button>
                </div>
              ) : !matchedAuth ? (
                // Waiting for a buyer
                <div className="col">
                  <div className="card-inner" style={{ borderColor: "rgba(26,102,64,0.10)" }}>
                    <div className="faint">Your offer is live</div>
                    <div style={{ fontSize: 20, marginTop: 8 }}>
                      {formatCsd(mySellOffer.payload.csdAmount)} CSD
                    </div>
                    <div className="muted" style={{ marginTop: 6 }}>
                      {formatUsdc(mySellOffer.payload.usdcAmount)} USDC ·{" "}
                      {mySellOffer.payload.pricePerCsd} USDC/CSD
                    </div>
                    <div className="mono faint" style={{ marginTop: 10 }}>
                      {shortHash(mySellOffer.objectHash)}
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: 14 }}>
                    Waiting for a buyer to create an authorization referencing your offer.
                  </div>
                  <button
                    className="btn-secondary"
                    onClick={cancelSellOffer}
                    disabled={!!loading}
                    style={{ fontSize: 13 }}
                  >
                    {loading ?? "Cancel offer"}
                  </button>
                </div>
              ) : (
                // Have a buyer auth — show lock + settlement flow
                <div className="col">
                  <div className="card-inner" style={{ borderColor: "rgba(26,102,64,0.12)" }}>
                    <div className="faint">Buyer authorization received</div>
                    <div style={{ marginTop: 8, fontSize: 17 }}>
                      {formatCsd(matchedAuth.payload.authorization.csdAmount)} CSD ·{" "}
                      {formatUsdc(matchedAuth.payload.authorization.usdcAmount)} USDC
                    </div>
                    <div className="mono" style={{ marginTop: 10, fontSize: 12 }}>
                      {matchedAuth.objectHash}
                    </div>
                  </div>

                  {lockedAmount === 0n ? (
                    // Not locked yet — seller locks
                    <div className="col">
                      <div className="muted" style={{ fontSize: 14 }}>
                        Lock USDC to begin settlement. Only lock when you are ready to send CSD immediately.
                      </div>
                      <button
                        className="btn"
                        onClick={lockSettlement}
                        disabled={!!loading}
                      >
                        {loading ?? "Lock USDC for settlement"}
                      </button>
                    </div>
                  ) : (
                    // Locked — show CSD send instructions + txid form
                    <div className="col">
                      <div className="card-inner" style={{ borderColor: "rgba(26,102,64,0.12)" }}>
                        <div className="faint">Settlement window</div>
                        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
                          {formatUsdc(lockedAmount.toString())} USDC reserved
                        </div>
                        {windowRemaining > 0 ? (
                          <div style={{ marginTop: 14, display: "flex", alignItems: "baseline", gap: 8 }}>
                            <span style={{
                              fontSize: 36, lineHeight: 1,
                              color: windowRemaining < 180 ? "var(--danger)" : windowRemaining < 600 ? "var(--warn)" : "var(--fg)",
                            }}>
                              {formatCountdown(windowRemaining)}
                            </span>
                            <span className="muted" style={{ fontSize: 13 }}>remaining</span>
                          </div>
                        ) : lockedAmount > 0n ? (
                          <div className="col" style={{ gap: 10, marginTop: 10 }}>
                            <div className="danger" style={{ fontSize: 13 }}>
                              Window expired. Settlement cannot proceed. Trigger refund to buyer.
                            </div>
                            <button className="btn-secondary" onClick={claimRefund} disabled={!!loading}>
                              {loading ?? "Refund buyer"}
                            </button>
                          </div>
                        ) : null}
                      </div>

                      {/* Revocation warning: buyer revoked on AON to block the executor */}
                      {revocationDetected && (
                        <div className="card-inner" style={{ borderColor: "rgba(192,57,43,0.25)" }}>
                          <div className="danger" style={{ fontWeight: 500, marginBottom: 6 }}>
                            ⚠ Buyer revoked authorization on AON
                          </div>
                          <div className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
                            The executor will not auto-settle a revoked authorization.
                            If you have already sent CSD, submit your txid below and click
                            "Settle directly". This calls the contract from your wallet,
                            bypassing the executor. The contract only checks the CSD payment,
                            not AON revocations.
                          </div>
                        </div>
                      )}

                      <div className="card-inner">
                        <div className="faint" style={{ marginBottom: 8 }}>Send CSD to buyer</div>
                        <div className="muted" style={{ fontSize: 13 }}>Address:</div>
                        <div className="mono" style={{ marginTop: 4 }}>
                          0x{matchedAuth.payload.authorization.sellerCsdScriptHash.slice(2, 42)}
                        </div>
                        <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>Amount:</div>
                        <div style={{ marginTop: 4, fontSize: 17 }}>
                          {formatCsd(matchedAuth.payload.authorization.csdAmount)} CSD
                        </div>
                      </div>

                      <div>
                        <label>CSD transaction ID</label>
                        <input
                          value={csdTxid}
                          onChange={e => setCsdTxid(e.target.value)}
                          placeholder="0x..."
                        />
                      </div>

                      {revocationDetected ? (
                        <button
                          className="btn-danger"
                          style={{ fontWeight: 600 }}
                          onClick={settleDirectly}
                          disabled={!csdTxid || !!loading}
                        >
                          {loading ?? "Settle directly (bypass executor)"}
                        </button>
                      ) : (
                        <button
                          className="btn"
                          onClick={submitCsdProof}
                          disabled={!csdTxid || !!loading}
                        >
                          {loading ?? "Verify payment + settle"}
                        </button>
                      )}
                      <div className="muted" style={{ fontSize: 13 }}>
                        Wait until the CSD transaction is mined before submitting.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Balances */}
      {isConnected && (
        <div className="balance-grid">
          <div className="card">
            <div className="faint">Ethereum wallet</div>
            <div style={{ marginTop: 14 }}>
              <div className="muted" style={{ fontSize: 13 }}>USDC</div>
              <div style={{ fontSize: 24, marginTop: 4 }}>{formatUsdc(usdcBalance)}</div>
            </div>
          </div>
          {csdReceiveAddr && (
            <div className="card">
              <div className="faint">Compute Substrate wallet</div>
              <div style={{ marginTop: 14 }}>
                <div className="muted" style={{ fontSize: 13 }}>CSD</div>
                <div style={{ fontSize: 24, marginTop: 4 }}>{formatCsd(csdBalance)}</div>
              </div>
            </div>
          )}
        </div>
      )}


      {/* ── Price chart ─────────────────────────────────────────────────────── */}
      {completedTrades.length > 1 && (() => {
        const chartData = [...completedTrades]
          .reverse()
          .map((t, i) => ({
            i,
            price: Math.round(t.pricePerCsd * 10000) / 10000,
            label: new Date(t.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
          }));
        const prices = chartData.map(d => d.price);
        const minP = Math.min(...prices), maxP = Math.max(...prices);
        const pad = (maxP - minP) * 0.15 || 0.01;
        return (
          <div className="card" style={{ marginTop: 18 }}>
            <div className="row-between" style={{ marginBottom: 16 }}>
              <div>
                <div className="faint">CSD / USDC price</div>
                <div style={{ fontSize: 20, marginTop: 4 }}>
                  {chartData[chartData.length - 1]?.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  <span className="muted" style={{ fontSize: 14, marginLeft: 8 }}>USDC / CSD</span>
                </div>
              </div>
              <div className="col" style={{ alignItems: "flex-end", gap: 4 }}>
                <div className="muted" style={{ fontSize: 12 }}>{completedTrades.length} trade{completedTrades.length !== 1 ? "s" : ""}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {minP.toFixed(4)} – {maxP.toFixed(4)}
                </div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fill: "var(--faint)", fontSize: 11,  }} axisLine={false} tickLine={false} />
                <YAxis domain={[minP - pad, maxP + pad]} tick={{ fill: "var(--faint)", fontSize: 11,  }} axisLine={false} tickLine={false} tickFormatter={v => v.toFixed(3)} />
                <Tooltip
                  contentStyle={{ background: "var(--bg)", border: "1px solid var(--border2)", borderRadius: 4, fontSize: 13 }}
                  labelStyle={{ color: "var(--muted)",  }}
                  formatter={(v: any) => [`${Number(v).toFixed(4)} USDC/CSD`, "Price"]}
                />
                <Line type="monotone" dataKey="price" stroke="var(--green)" strokeWidth={2} dot={{ fill: "var(--green)", r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      })()}

      {/* ── Completed trades ─────────────────────────────────────────────────── */}
      {completedTrades.length > 0 && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="faint" style={{ marginBottom: 14 }}>Completed trades</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Time", "CSD", "USDC", "Price", "Buyer", "Tx"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "0 12px 10px 0", color: "var(--muted)", fontWeight: 400, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {completedTrades.map(t => (
                  <tr key={t.receiptHash} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "10px 12px 10px 0", color: "var(--muted)" }}>
                      {new Date(t.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td style={{ padding: "10px 12px 10px 0" }}>{formatCsd(t.csdAmount)}</td>
                    <td style={{ padding: "10px 12px 10px 0" }}>{formatUsdc(t.usdcAmount)}</td>
                    <td style={{ padding: "10px 12px 10px 0", color: "var(--green)" }}>
                      {t.pricePerCsd.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </td>
                    <td style={{ padding: "10px 12px 10px 0", fontFamily: "var(--mono)", color: "var(--muted)" }}>
                      {short(t.buyer)}
                    </td>
                    <td style={{ padding: "10px 12px 10px 0" }}>
                      {t.executionTx ? (
                        <a href={`https://etherscan.io/tx/${t.executionTx}`} target="_blank" rel="noreferrer"
                          style={{ color: "var(--muted)", fontSize: 12 }}>
                          {shortHash(t.executionTx, 4)} ↗
                        </a>
                      ) : (
                        <a href={`https://explorer.aon.network?hash=${t.receiptHash}`} target="_blank" rel="noreferrer"
                          style={{ color: "var(--muted)", fontSize: 12 }}>
                          AON ↗
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Live log */}
      {logs.length > 0 && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="faint" style={{ marginBottom: 12 }}>Live log</div>
          <div className="col" style={{ gap: 6 }}>
            {logs.map((l, i) => (
              <div key={i} className="muted" style={{ fontSize: 13 }}>
                {new Date(l.ts).toLocaleTimeString()} {l.text}
              </div>
            ))}
          </div>
        </div>
      )}

      <footer style={{ marginTop: 64, paddingTop: 20, borderTop: "1px solid var(--border)" }}>
        <div className="muted" style={{ fontSize: 13 }}>
          Covenant · Powered by{" "}
          <a href="https://aon.network" target="_blank" rel="noreferrer">AON</a>
          {" "}and{" "}
          <a href="https://computesubstrate.org" target="_blank" rel="noreferrer">Compute Substrate</a>
          {" · "}
          <a href="/about">How it works</a>
          {" · "}No custody. No authority.
        </div>
      </footer>

    </main>
  );
}
