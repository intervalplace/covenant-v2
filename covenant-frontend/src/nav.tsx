"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "@wagmi/core";
import { CHAIN_ID } from "./config";
import { aonFetch, onNodeStatus, readOverrides, writeOverrides, DEFAULT_AON_NODES, DEFAULT_RPCS, type NodeStatus } from "./endpoints";
import { Arc } from "./arc";

function useNodeStatus() {
  const [st, setSt] = useState<NodeStatus & { checked: boolean }>({ node: null, ok: true, checked: false });
  useEffect(() => {
    const off = onNodeStatus(s => setSt({ ...s, checked: true }));
    const ping = () => aonFetch("/v1/objects?limit=1", { cache: "no-store" }).catch(() => {});
    ping();
    const id = setInterval(ping, 15000);
    return () => { off(); clearInterval(id); };
  }, []);
  return st;
}

const host = (u?: string | null) => { try { return u ? new URL(u).host : ""; } catch { return u ?? ""; } };

function ConnectionsPanel({ onClose, active }: { onClose: () => void; active: string | null }) {
  const cur = readOverrides();
  const [aon, setAon] = useState(cur.aonNode ?? "");
  const [rpc, setRpc] = useState(cur.rpc ?? "");
  const [err, setErr] = useState("");
  const valid = (u: string) => !u || /^https?:\/\/[^\s]+$/.test(u.trim());
  const save = () => {
    if (!valid(aon) || !valid(rpc)) { setErr("Enter full URLs starting with https://"); return; }
    writeOverrides({ aonNode: aon.trim() || undefined, rpc: rpc.trim() || undefined });
    window.location.reload(); // RPC transports are set up at load
  };
  const reset = () => { writeOverrides({}); window.location.reload(); };
  return (
    <div className="conn-panel" role="dialog" aria-label="Connections">
      <div className="row-between">
        <span className="panel-title">Connections</span>
        <button className="link-btn muted" onClick={onClose}>Close</button>
      </div>
      <p className="faint" style={{ marginTop: 6, lineHeight: 1.5 }}>
        Covenant reads the order book from an AON node and talks to Ethereum through an RPC.
        Add your own to stop depending on the defaults. Saved in this browser only.
      </p>
      <label htmlFor="conn-aon" style={{ marginTop: 14 }}>AON node</label>
      <input id="conn-aon" value={aon} onChange={e => setAon(e.target.value)} placeholder={DEFAULT_AON_NODES[0]} autoComplete="off" spellCheck={false} />
      <div className="faint" style={{ marginTop: 4 }}>
        In use: {active ? host(active) : "none reachable"}. Fallbacks: {DEFAULT_AON_NODES.map(host).join(", ")}
      </div>
      <label htmlFor="conn-rpc" style={{ marginTop: 14 }}>Ethereum RPC</label>
      <input id="conn-rpc" value={rpc} onChange={e => setRpc(e.target.value)} placeholder="https://…" autoComplete="off" spellCheck={false} />
      <div className="faint" style={{ marginTop: 4, lineHeight: 1.5 }}>
        With a wallet connected to Ethereum, Covenant reads through your wallet. Otherwise, or if it fails: {DEFAULT_RPCS.map(host).join(", ")}
      </div>
      {err && <div className="danger" style={{ fontSize: 14, marginTop: 10 }}>{err}</div>}
      <div className="row" style={{ marginTop: 16, gap: 10 }}>
        <button className="btn" onClick={save}>Save and reload</button>
        <button className="btn-secondary" onClick={reset}>Use defaults</button>
      </div>
    </div>
  );
}

export function SiteNav() {
  const path = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { address, isConnected, chainId } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const st = useNodeStatus();
  const up = st.checked ? st.ok : null;
  const [connOpen, setConnOpen] = useState(false);

  const link = (href: string, label: string) => (
    <Link href={href} aria-current={path === href ? "page" : undefined}>{label}</Link>
  );

  return (
    <nav className="site-nav" aria-label="Main">
      <div className="site-nav-inner">
        <Link href="/" className="wordmark" aria-label="Covenant home">
          <Arc width={104} sagitta={16} thickness={2.6} />
          <span>Covenant</span>
        </Link>
        <div className="nav-links">
          {link("/", "Trade")}
          {link("/about", "How it works")}
          {link("/docs", "Docs")}
        </div>
        <div className="nav-right">
          <button className="net-status" onClick={() => setConnOpen(o => !o)} aria-expanded={connOpen}
            title={up === false ? "Can't reach any AON node. Open connection settings." : `Connected via ${host(st.node)}. Open connection settings.`}>
            <span className={`dot ${up === null ? "" : up ? "dot-live" : "dot-down"}`} />
            <span>{up === false ? "Network unreachable" : "Network live"}</span>
          </button>
          {connOpen && <ConnectionsPanel onClose={() => setConnOpen(false)} active={st.node} />}
          {mounted && (isConnected ? (
            <button className="btn-secondary wallet-chip" onClick={() => disconnect()} title="Disconnect wallet">
              {chainId !== CHAIN_ID && <span className="danger">Wrong network </span>}
              {address?.slice(0, 6)}…{address?.slice(-4)}
            </button>
          ) : (
            <button className="btn wallet-chip" onClick={() => connect({ connector: injected() })}>Connect wallet</button>
          ))}
        </div>
      </div>
    </nav>
  );
}
