/**
 * Where the interface connects: AON nodes (the order book) and Ethereum RPCs.
 *
 * The site itself can live on IPFS, but it's only as unstoppable as the
 * services it talks to. So nothing here is a single point of failure:
 *   - every endpoint has fallbacks, tried in order, and the last one that
 *     worked is tried first next time;
 *   - users can add their own AON node or RPC in Settings (saved in their
 *     browser), which then takes priority.
 */

import { mainnet } from "viem/chains";

const STORAGE_KEY = "covenant.endpoints";

const list = (s?: string) => (s ?? "").split(",").map(x => x.trim().replace(/\/+$/, "")).filter(Boolean);
const uniq = (xs: string[]) => [...new Set(xs)];

export const DEFAULT_AON_NODES = uniq([
  ...list(process.env.NEXT_PUBLIC_AON_NODE_URL || "https://explorer.aon.network"),
  ...list(process.env.NEXT_PUBLIC_AON_NODE_FALLBACKS),
]);

export const DEFAULT_RPCS = uniq([
  ...list(process.env.NEXT_PUBLIC_ETH_RPC_URL),
  ...list(process.env.NEXT_PUBLIC_ETH_RPC_FALLBACKS),
  ...mainnet.rpcUrls.default.http,
  "https://ethereum-rpc.publicnode.com",
]);

export type Overrides = { aonNode?: string; rpc?: string };

export function readOverrides(): Overrides {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}
export function writeOverrides(o: Overrides) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(o)); } catch {}
}

export const aonNodes = () => uniq([...list(readOverrides().aonNode), ...DEFAULT_AON_NODES]);
export const rpcUrls  = () => uniq([...list(readOverrides().rpc), ...DEFAULT_RPCS]);

// ── AON requests with failover ────────────────────────────────────────────────

let preferred: string | null = null;
const listeners = new Set<(s: NodeStatus) => void>();
export type NodeStatus = { node: string | null; ok: boolean };
let status: NodeStatus = { node: null, ok: true };
const emit = (s: NodeStatus) => { status = s; listeners.forEach(f => f(s)); };
export const nodeStatus = () => status;
export function onNodeStatus(f: (s: NodeStatus) => void) { listeners.add(f); return () => { listeners.delete(f); }; }

/**
 * fetch() against the AON node list. Network errors and 5xx move on to the
 * next node. Objects are content-addressed, so retrying a POST elsewhere is
 * safe: the same object has the same hash on every node.
 */
export async function aonFetch(path: string, init?: RequestInit, timeoutMs = 8000): Promise<Response> {
  const nodes = aonNodes();
  const order = preferred && nodes.includes(preferred) ? [preferred, ...nodes.filter(n => n !== preferred)] : nodes;
  let lastErr: unknown = null;
  for (const node of order) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${node}${path}`, { ...init, signal: ctl.signal });
      if (res.status >= 500) throw new Error(`AON node ${node} returned ${res.status}`);
      preferred = node;
      emit({ node, ok: true });
      return res;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(t);
    }
  }
  emit({ node: null, ok: false });
  throw lastErr ?? new Error("NO_AON_NODE_REACHABLE");
}

// ── The user's wallet as the Ethereum connection ──────────────────────────────
//
// Once a wallet is connected, reads go through the wallet's own RPC, so the
// interface needs no RPC of its own. Two guards:
//   - only while the wallet reports the expected chain (a wallet switched to
//     another network would otherwise return that network's data);
//   - only read methods; anything else falls through to the next transport.
// Throwing makes viem's fallback() move on to the next RPC in the list.

const READ_METHODS = new Set([
  "eth_call", "eth_chainId", "eth_blockNumber", "eth_getBalance", "eth_getCode", "eth_getStorageAt",
  "eth_getTransactionCount", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByNumber",
  "eth_getBlockByHash", "eth_getLogs", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas",
  "eth_feeHistory", "net_version",
]);

type Eip1193 = { request: (a: { method: string; params?: any }) => Promise<any>; on?: (e: string, f: (x: any) => void) => void };

export function walletReader(eth: Eip1193, expectedChainId: number): Eip1193 {
  let chain: number | null = null, connected = false, checkedAt = 0;
  const refresh = async () => {
    checkedAt = Date.now();
    try {
      const [c, accts] = await Promise.all([eth.request({ method: "eth_chainId" }), eth.request({ method: "eth_accounts" })]);
      chain = Number(c); connected = Array.isArray(accts) && accts.length > 0;
    } catch { chain = null; connected = false; }
  };
  eth.on?.("chainChanged", (c: any) => { chain = Number(c); });
  eth.on?.("accountsChanged", (a: any) => { connected = Array.isArray(a) && a.length > 0; });
  return {
    async request(args) {
      if (!READ_METHODS.has(args.method)) throw new Error("WALLET_READS_ONLY");
      if (chain === null || Date.now() - checkedAt > 30_000) await refresh();
      if (!connected) throw new Error("WALLET_NOT_CONNECTED");
      if (chain !== expectedChainId) throw new Error("WALLET_ON_OTHER_CHAIN");
      return eth.request(args);
    },
  };
}

/** RPC order: the user's own (Connections) > their wallet > configured > public. */
export function rpcPlan(): { override: string[]; rest: string[] } {
  const own = list(readOverrides().rpc);
  return { override: own, rest: DEFAULT_RPCS.filter(u => !own.includes(u)) };
}
