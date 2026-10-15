// Covenant executor: settles matched trades from AON on Ethereum.
//
// Anyone can run this. It holds no trader funds and can't change any trade:
// every fill it submits is checked by the settlement contract against both
// traders' signatures. All it does is pay gas to settle what's been matched,
// and publish a receipt. If no executor runs, traders can settle their own
// trades from the app.
//
// Unlike the SDK's stock runExecutor, this validates every object (signatures,
// revocations, and receipts against the on-chain event) before evaluating, so
// forged receipts or revocations can't make it skip real trades.

import { AonNodeClient, registerNamespace } from "@intervalplace/aon-sdk";
import { evmSpotNamespace } from "@intervalplace/namespace-evm-spot";
import { createPublicClient, http, formatEther, parseEther, isAddress, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined || v === "") { console.error(`Missing ${k}. See .env.example.`); process.exit(1); }
  return v;
};
const RPC = env("AON_EVM_RPC_URL");
const KEY = env("AON_EXECUTOR_PRIVATE_KEY") as `0x${string}`;
const CONTRACT = env("AON_EVM_SPOT_SETTLEMENT_CONTRACT");
const NODES = env("AON_NODE_URLS", "https://explorer.aon.network").split(",").map(s => s.trim()).filter(Boolean);
const POLL = Number(env("POLL_INTERVAL_MS", "3000"));
const MIN_ETH = parseEther(env("MIN_ETH_BALANCE", "0.02"));
const MIN_FEE = BigInt(env("MIN_FEE_QUOTE", "0"));
const NS = "aon:evm-spot";

if (!isAddress(CONTRACT)) { console.error("AON_EVM_SPOT_SETTLEMENT_CONTRACT is not an address"); process.exit(1); }
if (!/^0x[0-9a-fA-F]{64}$/.test(KEY)) { console.error("AON_EXECUTOR_PRIVATE_KEY must be 0x + 64 hex characters"); process.exit(1); }

const account = privateKeyToAccount(KEY);
const pub = createPublicClient({ transport: http(RPC) });
const clients = NODES.map(u => ({ url: u, c: new AonNodeClient(u) }));
registerNamespace(evmSpotNamespace);

const log = (...a: any[]) => console.log(new Date().toISOString(), ...a);

// Objects are content-addressed and immutable, so a validation result holds
// forever. Failures are retried later (an RPC hiccup shouldn't drop a receipt).
const valid = new Map<string, boolean>();
const failedAt = new Map<string, number>();
async function validObjects(objs: any[]) {
  const out: any[] = [];
  for (const o of objs) {
    const h = String(o.objectHash ?? "").toLowerCase();
    if (!h) continue;
    if (valid.get(h)) { out.push(o); continue; }
    if (Date.now() - (failedAt.get(h) ?? 0) < 5 * 60_000) continue;
    try { await evmSpotNamespace.validateObject!(o); valid.set(h, true); out.push(o); }
    catch { failedAt.set(h, Date.now()); }
  }
  return out;
}

async function listAll() {
  for (const { url, c } of clients) {
    try {
      const out: any[] = [];
      const limit = 1000;
      for (let offset = 0; ; offset += limit) {
        const page = await c.listObjects({ namespace: NS, limit, offset });
        out.push(...page);
        if (page.length < limit) break;
      }
      return out;
    } catch (e: any) { log(`[node] ${url} unreachable: ${e?.message ?? e}`); }
  }
  throw new Error("no AON node reachable");
}

async function publish(receipt: any) {
  const results = await Promise.allSettled(clients.map(({ c }) => c.putObject(receipt)));
  const ok = results.filter(r => r.status === "fulfilled").length;
  log(`[receipt] ${receipt.objectHash} published to ${ok}/${clients.length} node(s)`);
}

let lastBalanceWarn = 0;
async function checkBalance(force = false) {
  const bal = await pub.getBalance({ address: account.address });
  if (bal < MIN_ETH && (force || Date.now() - lastBalanceWarn > 30 * 60_000)) {
    lastBalanceWarn = Date.now();
    console.warn(`${new Date().toISOString()} [LOW BALANCE] executor ${account.address} has ${formatEther(bal)} ETH (< ${formatEther(MIN_ETH)}). Top it up or settlements will stop.`);
  }
  return bal;
}

async function pollOnce() {
  const objs = await listAll();
  const graphs = evmSpotNamespace.evaluate(await validObjects(objs)).filter((g: any) => g.status === "executable");
  for (const g of graphs) {
    const fee = BigInt(g.fill?.payload?.fill?.executorFeeQuoteAmount ?? 0);
    if (fee < MIN_FEE) continue;
    try {
      const r: any = await evmSpotNamespace.execute!(g, { mode: "contract" });
      const s = r?.details?.settled;
      log(`[settled] fill ${g.fill.objectHash} tx ${r.executionTx}${s ? ` base ${s.baseAmount} quote ${s.quoteAmount} fee ${s.executorFeeQuoteAmount}` : ""}`);
      if (r?.receiptObject) { valid.set(String(r.receiptObject.objectHash).toLowerCase(), true); await publish(r.receiptObject); }
    } catch (e: any) {
      // Usually benign: someone else settled it first, or a trader cancelled.
      // The namespace backs off this fill before trying again.
      log(`[skip] fill ${g.fill?.objectHash}: ${String(e?.shortMessage ?? e?.message ?? e).split("\n")[0]}`);
    }
  }
}

async function preflight() {
  const chainId = await pub.getChainId();
  const code = await pub.getCode({ address: getAddress(CONTRACT) });
  if (!code || code === "0x") { console.error(`No contract at ${CONTRACT} on chain ${chainId}. Check the address and RPC.`); process.exit(1); }
  const bal = await checkBalance(true);
  log(`[start] executor ${account.address} on chain ${chainId}, ${formatEther(bal)} ETH`);
  log(`[start] contract ${getAddress(CONTRACT)}, nodes ${NODES.join(", ")}, polling every ${POLL}ms${MIN_FEE > 0n ? `, min fee ${MIN_FEE}` : ""}`);
  const objs = await listAll();
  log(`[start] node reachable: ${objs.length} aon:evm-spot objects`);
}

await preflight();
if (process.argv.includes("--check")) { log("[check] all good"); process.exit(0); }

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { log("[stop] finishing current poll"); stopping = true; });
let delay = POLL;
while (!stopping) {
  try { await pollOnce(); delay = POLL; }
  catch (e: any) { delay = Math.min(delay * 2, 60_000); log(`[poll] ${e?.message ?? e}; retrying in ${delay}ms`); }
  try { await checkBalance(); } catch {}
  await new Promise(r => setTimeout(r, delay));
}
process.exit(0);
