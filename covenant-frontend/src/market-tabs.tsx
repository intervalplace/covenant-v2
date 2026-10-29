"use client";
// Switches between the EVM market(s) on / and CSD/USDC on /csd/.
import Link from "next/link";
import { MARKETS } from "./config";
import { CSD_ENABLED } from "./csd/config";

export function MarketTabs({ active }: { active: string }) {
  const evm = MARKETS[0];
  if (!CSD_ENABLED && active !== "CSD-USDC") return <h2 className="market-title">{evm.label}</h2>;
  const tab = (href: string, key: string, label: string) => (
    <Link key={key} href={href} role="tab" aria-selected={key === active} className={key === active ? "tab tab-on" : "tab"}>{label}</Link>
  );
  return (
    <div className="market-tabs" role="tablist" aria-label="Market">
      {tab("/", evm.key, evm.label)}
      {tab("/csd/", "CSD-USDC", "CSD / USDC")}
    </div>
  );
}
