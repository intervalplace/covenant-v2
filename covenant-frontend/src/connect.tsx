"use client";
// The one "Connect wallet" button. With exactly one way to connect, a click connects. With several
// (more than one wallet extension, or an extension plus a phone wallet), or none, a small menu
// opens, so a click never silently does nothing.
import { useEffect, useRef, useState } from "react";
import { useConnect, useConnectors } from "wagmi";
import { browserWallet, phoneWallet } from "@/providers";
import { safeEthereum } from "./endpoints";

function hasDefaultWallet(): boolean {
  try { return typeof safeEthereum((window as any).ethereum)?.request === "function"; } catch { return false; }
}

const quiet = (m: string) => /reject|denied|cancel|closed/i.test(m);
type Option = { key: string; name: string; icon?: string; connector: any };

export function ConnectWallet({ className = "btn", label = "Connect wallet" }: { className?: string; label?: string }) {
  const { connect, error, isPending, reset } = useConnect();
  const connectors = useConnectors();
  const [open, setOpen] = useState(false);
  const [hasDefault, setHasDefault] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => { setHasDefault(hasDefaultWallet()); }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  // Wallets that announced themselves; the default (window.ethereum) only when none did.
  const announced = connectors.filter(c => c.id !== "injected" && c.type === "injected");
  const options = (def: boolean): Option[] => [
    ...announced.map(c => ({ key: c.id, name: c.name, icon: c.icon, connector: c })),
    ...(announced.length === 0 && def ? [{ key: "injected", name: "Wallet in this browser", connector: browserWallet }] : []),
    ...(phoneWallet ? [{ key: "wc", name: "Wallet on your phone (QR code)", connector: phoneWallet }] : []),
  ];

  const use = (c: any) => { setOpen(false); reset(); connect({ connector: c }); };
  const click = () => {
    const def = hasDefaultWallet(); setHasDefault(def);
    const opts = options(def);
    if (opts.length === 1) return use(opts[0].connector);
    setOpen(o => !o);
  };
  const opts = options(hasDefault);
  const browserOpts = opts.filter(o => o.key !== "wc");
  const msg = error && !quiet(error.message) ? error.message.split("\n")[0] : "";

  return (
    <span className="connect-wrap" ref={ref}>
      <button className={className} onClick={click} disabled={isPending}>{isPending ? "Connecting…" : label}</button>
      {open && (
        <div className="conn-panel connect-menu" role="dialog" aria-label="Connect a wallet">
          <span className="panel-title">Connect a wallet</span>
          {browserOpts.map(o => (
            <button key={o.key} className="btn connect-option" onClick={() => use(o.connector)}>
              {o.icon && <img src={o.icon} alt="" width={20} height={20} />}<span>{o.name}</span>
            </button>
          ))}
          {browserOpts.length === 0 && (
            <p className="faint" style={{ lineHeight: 1.5, margin: 0 }}>
              No wallet found in this browser. Install a wallet extension such as MetaMask or Rabby and reload,
              {phoneWallet ? " or connect a wallet on your phone." : " or open covenant.market in your wallet app's browser."}
            </p>
          )}
          {phoneWallet && (
            <button className={browserOpts.length ? "btn-secondary connect-option" : "btn connect-option"} onClick={() => use(phoneWallet)}>
              <span>Wallet on your phone (QR code)</span>
            </button>
          )}
        </div>
      )}
      {msg && <span className="connect-error danger" role="alert">{msg}</span>}
    </span>
  );
}
