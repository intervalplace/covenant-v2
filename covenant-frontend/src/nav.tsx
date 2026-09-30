"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "@wagmi/core";
import { AON_NODE_URL, CHAIN_ID } from "./config";
import { Arc } from "./arc";

function useNodeStatus() {
  const [up, setUp] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const r = await fetch(`${AON_NODE_URL}/v1/objects?limit=1`, { cache: "no-store" });
        if (alive) setUp(r.ok);
      } catch { if (alive) setUp(false); }
    };
    ping();
    const id = setInterval(ping, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return up;
}

export function SiteNav() {
  const path = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { address, isConnected, chainId } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const up = useNodeStatus();

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
          <div className="net-status" title={up === false ? "Can't reach the AON network. Retrying." : "Connected to the AON network"}>
            <span className={`dot ${up === null ? "" : up ? "dot-live" : "dot-down"}`} />
            <span>{up === false ? "Network unreachable" : "Network live"}</span>
          </div>
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
