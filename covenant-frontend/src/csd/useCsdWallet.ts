"use client";
// The in-site CSD wallet. Its keys come from one signature by the user's
// Ethereum wallet over a fixed message, so the same Ethereum wallet recreates
// the same CSD wallet on any device. That signature is the secret: it is kept
// in this browser (unless the user chooses not to) and never sent anywhere.
//
// Each buy receives on a fresh address (the contract allows one open trade per
// CSD address); change goes back to the first address.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSignMessage } from "wagmi";
import type { Address, Hex } from "viem";
import { CSD_WALLET_MESSAGE, deriveCsdWallet, csdNode, buildPayment, type CsdKey, type CsdUtxo } from "./csd-wallet";
import { CSD_MM_URL } from "./config";

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch {} },
  del(k: string) { try { localStorage.removeItem(k); } catch {} },
};
const SCAN_GAP = 3; // addresses checked past the last one known to be used

export function useCsdWallet(account?: Address) {
  const { signMessageAsync } = useSignMessage();
  const k = account ? `covenant.csd.v1.${account.toLowerCase()}` : "";
  const [secret, setSecret] = useState<Hex | null>(null);
  const [nextIndex, setNextIndex] = useState(1);
  const [coins, setCoins] = useState<CsdUtxo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const sessionSecret = useRef<Record<string, Hex>>({});

  useEffect(() => {
    setCoins([]); setLoaded(false); setError("");
    if (!k) { setSecret(null); return; }
    setSecret((store.get(k) as Hex | null) ?? sessionSecret.current[k] ?? null);
    setNextIndex(Number(store.get(`${k}.next`) ?? "1") || 1);
  }, [k]);

  const wallet = useMemo(() => (secret ? deriveCsdWallet(secret) : null), [secret]);
  const node = useMemo(() => csdNode(`${CSD_MM_URL}/api/csd`), []);
  const main = wallet?.key(0) ?? null;

  // Signs twice the first time on a device: a wallet whose signatures change
  // each time couldn't recreate the same CSD wallet later.
  const setup = useCallback(async (remember = true) => {
    if (!k) throw new Error("Connect a wallet first");
    const a = await signMessageAsync({ message: CSD_WALLET_MESSAGE });
    const b = await signMessageAsync({ message: CSD_WALLET_MESSAGE });
    if (a.toLowerCase() !== b.toLowerCase())
      throw new Error("This wallet gives a different signature each time, so it couldn't recreate your CSD wallet later. Use another Ethereum wallet for CSD.");
    if (remember) store.set(k, a); else sessionSecret.current[k] = a;
    setSecret(a);
    return deriveCsdWallet(a);
  }, [k, signMessageAsync]);

  const forget = useCallback(() => { if (!k) return; store.del(k); delete sessionSecret.current[k]; setSecret(null); setCoins([]); }, [k]);

  const refresh = useCallback(async () => {
    if (!wallet) return;
    try {
      const all: CsdUtxo[] = []; let next = nextIndex;
      for (let i = 0; i < next + SCAN_GAP && i < 200; i++) {
        const c = await node.utxos(wallet.key(i));
        if (c.length && i >= next) next = i + 1;
        all.push(...c);
      }
      if (next !== nextIndex) { setNextIndex(next); store.set(`${k}.next`, String(next)); }
      setCoins(all); setLoaded(true); setError("");
    } catch (e: any) { setError(e.message ?? String(e)); }
  }, [wallet, node, nextIndex, k]);

  useEffect(() => { if (!wallet) return; refresh(); const id = setInterval(refresh, 20_000); return () => clearInterval(id); }, [wallet, refresh]);

  // A fresh receiving address for a trade
  const freshKey = useCallback((w = wallet): CsdKey => {
    if (!w) throw new Error("CSD wallet not set up");
    const i = Math.max(1, Number(store.get(`${k}.next`) ?? nextIndex) || 1);
    store.set(`${k}.next`, String(i + 1)); setNextIndex(i + 1);
    return w.key(i);
  }, [wallet, k, nextIndex]);

  const balance = coins.reduce((s, c) => s + c.value, 0n);

  // A signed payment from this wallet (not broadcast), from all its coins or just the ones given
  const pay = useCallback((to: { value: bigint; addr20: Hex }[], from?: CsdUtxo[]) => {
    if (!wallet) throw new Error("CSD wallet not set up");
    return buildPayment({ utxos: from ?? coins, to, change: wallet.key(0).addr20 });
  }, [wallet, coins]);

  const send = useCallback(async (to: Hex, value: bigint) => {
    const p = pay([{ value, addr20: to }]);
    await node.submit(p.tx);
    setCoins(cs => cs.filter(c => !p.spent.some(s => s.txid === c.txid && s.vout === c.vout)));
    return p.txid;
  }, [pay, node]);

  return { ready: !!wallet, wallet, main, coins, balance, loaded, error, setup, forget, refresh, freshKey, pay, send, spentLocally: (txids: Set<string>) => setCoins(cs => cs.filter(c => !txids.has(c.txid))) };
}
