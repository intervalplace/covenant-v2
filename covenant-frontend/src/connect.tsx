"use client";
// The one "Connect wallet" button. A browser wallet (an extension, or the browser inside a wallet
// app) connects directly. Without one, or when a phone wallet (WalletConnect) is also available,
// it opens a small menu, so a click never silently does nothing.
import { useEffect, useRef, useState } from "react";
import { useConnect } from "wagmi";
import { browserWallet, phoneWallet } from "@/providers";
import { safeEthereum } from "./endpoints";

function hasBrowserWallet(): boolean {
  try { return typeof safeEthereum((window as any).ethereum)?.request === "function"; } catch { return false; }
}

const quiet = (m: string) => /reject|denied|cancel|closed/i.test(m);

export function ConnectWallet({ className = "btn", label = "Connect wallet" }: { className?: string; label?: string }) {
  const { connect, error, isPending, reset } = useConnect();
  const [open, setOpen] = useState(false);
  const [browser, setBrowser] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { setBrowser(hasBrowserWallet()); }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const use = (c: any) => { setOpen(false); reset(); connect({ connector: c }); };
  const click = () => {
    const now = hasBrowserWallet(); setBrowser(now);
    if (now && !phoneWallet) return use(browserWallet);
    setOpen(o => !o);
  };
  const msg = error && !quiet(error.message) ? (error.message.split("\n")[0]) : "";

  return (
    <span className="connect-wrap" ref={ref}>
      <button className={className} onClick={click} disabled={isPending}>{isPending ? "Connecting…" : label}</button>
      {open && (
        <div className="conn-panel connect-menu" role="dialog" aria-label="Connect a wallet">
          <span className="panel-title">Connect a wallet</span>
          {browser ? (
            <button className="btn" onClick={() => use(browserWallet)}>Wallet in this browser</button>
          ) : (
            <p className="faint" style={{ lineHeight: 1.5, margin: 0 }}>
              No wallet found in this browser. Install a wallet extension such as MetaMask or Rabby and reload,
              {phoneWallet ? " or connect a wallet on your phone." : " or open covenant.market in your wallet app's browser."}
            </p>
          )}
          {phoneWallet && <button className={browser ? "btn-secondary" : "btn"} onClick={() => use(phoneWallet)}>Wallet on your phone (QR code)</button>}
        </div>
      )}
      {msg && <span className="connect-error danger" role="alert">{msg}</span>}
    </span>
  );
}
