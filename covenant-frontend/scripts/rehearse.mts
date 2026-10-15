/**
 * Mainnet-fork rehearsal for Covenant.
 *
 *   FORK_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/<key> \
 *   NAMESPACE_DIR=../aon-namespace-evm-spot \
 *   npm run rehearse
 *
 * Starts a local fork of Ethereum mainnet with anvil (install Foundry first:
 * https://getfoundry.sh), then, against REAL WETH, USDT and Chainlink:
 *   1. compiles and deploys the settlement contract with the exact settings
 *      you'll use for the real deployment,
 *   2. checks the Chainlink market price the site will show,
 *   3. trades through Covenant's own order code and the real executor code:
 *      a sweep across two price levels with native ETH payout, a blocked
 *      front-running attempt, and an on-chain cancel,
 *   4. measures settlement gas and what it costs at today's gas price.
 *
 * Everything happens on the local fork. No real funds, no real transactions,
 * nothing is published to AON. Exits non-zero if anything fails.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createPublicClient, createWalletClient, http, defineChain, parseUnits, formatUnits, maxUint256,
  encodeFunctionData, decodeErrorResult, keccak256, encodeAbiParameters, pad, toHex, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, "..");
const FORK = process.env.FORK_RPC_URL;
const ATTACH = process.env.REHEARSE_ATTACH_RPC; // use an already-running chain (for testing this script)
const NSDIR = resolve(process.env.NAMESPACE_DIR ?? join(ROOT, "../aon-namespace-evm-spot"));
const PORT = Number(process.env.REHEARSE_PORT ?? 8546);

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const COMPILER = { version: "0.8.26", optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "cancun" } as const;

let pass = 0, anvil: ChildProcess | null = null, stage = "";
const ok = (l: string) => { pass++; console.log(`  ✓ ${l}`); };
function fail(l: string): never { console.error(`\n  ✗ ${l}\n\nRehearsal FAILED. Do not deploy until this is understood.`); cleanup(); process.exit(1); }
const check = (c: any, l: string) => (c ? ok(l) : fail(l));
function cleanup() { anvil?.kill(); if (stage) rmSync(stage, { recursive: true, force: true }); }
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("unhandledRejection", (e: any) => fail(`unexpected error: ${e?.shortMessage ?? e?.details ?? e?.message ?? e}`));
process.on("uncaughtException", (e: any) => fail(`unexpected error: ${e?.shortMessage ?? e?.details ?? e?.message ?? e}`));

// ── 0. Preconditions ──────────────────────────────────────────────────────────
const contractPath = join(NSDIR, "src/contracts/GenericEvmSpotSettlement.sol");
if (!existsSync(contractPath)) fail(`Can't find the namespace at ${NSDIR}. Set NAMESPACE_DIR to the patched aon-namespace-evm-spot repo.`);
const source = readFileSync(contractPath, "utf8");
if (!["counterSetHash", "WRAPPED_NATIVE", "CounterLeg", "usedFill", "ReceivedLessThanSigned", "ReservedPartVoid", "boundFilledBase"].every(k => source.includes(k)))
  fail("That contract isn't the reviewed version. Use the latest patched aon-namespace-evm-spot.");
if (!FORK && !ATTACH) fail("Set FORK_RPC_URL to a mainnet RPC (Alchemy, Infura, your own node).");

console.log("\nCovenant mainnet-fork rehearsal\n");

// ── 1. Fork ───────────────────────────────────────────────────────────────────
let rpc = ATTACH ?? `http://127.0.0.1:${PORT}`;
if (!ATTACH) {
  console.log(`[1] Forking mainnet with anvil on :${PORT}…`);
  try { anvil = spawn("anvil", ["--fork-url", FORK!, "--port", String(PORT), "--silent"], { stdio: ["ignore", "ignore", "pipe"] }); }
  catch { fail("anvil not found. Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"); }
  anvil.on("error", () => fail("anvil not found. Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"));
} else console.log(`[1] Using existing chain at ${rpc}`);

const chain = defineChain({ id: 1, name: "mainnet-fork", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const pub = createPublicClient({ chain, transport: http(rpc) });
for (let i = 0; i < 60; i++) { try { await pub.getBlockNumber(); break; } catch { await new Promise(r => setTimeout(r, 500)); if (i === 59) fail("The fork didn't start. Check FORK_RPC_URL (an archive-capable RPC works best)."); } }
check(await pub.getChainId() === 1, `fork is up at block ${await pub.getBlockNumber()} (chain id 1)`);
check((await pub.getCode({ address: WETH }))?.length! > 2 && (await pub.getCode({ address: USDT }))?.length! > 2, "real WETH and USDT contracts are present");

// Anvil's well-known test keys (only meaningful on the local fork)
const keys = ["0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"] as const;
const [deployer, executor, alice, bob, mallory] = keys.map(k => privateKeyToAccount(k));
const wallet = (a: any) => createWalletClient({ account: a, chain, transport: http(rpc) });
for (const a of [deployer, executor, alice, bob, mallory]) await pub.request({ method: "anvil_setBalance" as any, params: [a.address, toHex(parseUnits("100", 18))] as any });

// ── 2. Compile + deploy ───────────────────────────────────────────────────────
console.log(`\n[2] Compiling with solc ${COMPILER.version}, optimizer ${COMPILER.optimizer.runs} runs, viaIR, ${COMPILER.evmVersion}…`);
const solc = require("solc");
if (!String(solc.version()).startsWith(COMPILER.version)) fail(`solc ${solc.version()} installed; expected ${COMPILER.version}. Run npm ci.`);
const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "GenericEvmSpotSettlement.sol": { content: source } },
  settings: { optimizer: COMPILER.optimizer, viaIR: COMPILER.viaIR, evmVersion: COMPILER.evmVersion, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } } } })));
for (const e of out.errors ?? []) if (e.severity === "error") fail(`compile error: ${e.formattedMessage}`);
const C = out.contracts["GenericEvmSpotSettlement.sol"].AonEvmSpotSettlement;
// A tiny contract wallet that refuses ETH, to exercise the WETH fallback
const out2 = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "RejectEth.sol": { content: "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\ncontract RejectEth { receive() external payable { revert(); } }" } },
  settings: { optimizer: COMPILER.optimizer, evmVersion: COMPILER.evmVersion, outputSelection: { "*": { "*": ["evm.deployedBytecode.object"] } } } })));
const abi = C.abi, runtimeBytes = C.evm.deployedBytecode.object.length / 2;
check(runtimeBytes < 24576, `compiles (runtime ${runtimeBytes} bytes, under the 24,576-byte limit)`);
const dh = await wallet(deployer).deployContract({ abi, bytecode: `0x${C.evm.bytecode.object}`, args: [WETH] });
const drc = await pub.waitForTransactionReceipt({ hash: dh });
const settlement = drc.contractAddress!;
check(drc.status === "success", `deployed at ${settlement} for ${drc.gasUsed.toLocaleString()} gas`);
check((await pub.readContract({ address: settlement, abi, functionName: "WRAPPED_NATIVE" }) as string).toLowerCase() === WETH.toLowerCase(), "WRAPPED_NATIVE is mainnet WETH");

// ── 3. Load Covenant's order code and the executor (same code that ships) ─────
Object.assign(process.env, {
  NEXT_PUBLIC_CHAIN_ID: "1", NEXT_PUBLIC_EVM_SPOT_SETTLEMENT: settlement, NEXT_PUBLIC_EXECUTOR_FEE_BPS: "10",
  AON_EVM_RPC_URL: rpc, AON_EXECUTOR_PRIVATE_KEY: keys[1], AON_EVM_SPOT_SETTLEMENT_CONTRACT: settlement,
});
stage = mkdtempSync(join(tmpdir(), "covenant-rehearse-"));
cpSync(join(ROOT, "src"), join(stage, "fe"), { recursive: true });
cpSync(join(NSDIR, "src"), join(stage, "ns"), { recursive: true });
for (const d of ["fe", "ns"]) writeFileSync(join(stage, d, "package.json"), '{"type":"module"}');
for (const f of readdirSync(join(stage, "fe")).filter(f => f.endsWith(".ts"))) {
  const p = join(stage, "fe", f);
  writeFileSync(p, readFileSync(p, "utf8").replace(/from "\.\/([a-zA-Z]+)"/g, 'from "./$1.ts"'));
}
symlinkSync(join(ROOT, "node_modules"), join(stage, "node_modules"));
const cfg = await import(join(stage, "fe/config.ts"));
const A = await import(join(stage, "fe/aon.ts"));
const R = await import(join(stage, "fe/reference.ts"));
const { evmSpotNamespace: ns } = await import(join(stage, "ns/namespace.ts"));
const { finalizeObject } = await import("@intervalplace/aon-sdk");
const fin = (o: any) => finalizeObject(o) as any;
const m = cfg.MARKETS[0];
check(m.key === "ETH-USDT" && m.base.address.toLowerCase() === WETH.toLowerCase() && m.quote.address.toLowerCase() === USDT.toLowerCase(), "site config: ETH/USDT on mainnet WETH and USDT");

// ── 4. Chainlink ──────────────────────────────────────────────────────────────
console.log("\n[3] Chainlink market price (what the site shows)");
const ref = await R.getReference(pub as any, m, 0);
if (!ref) fail("No Chainlink reference for ETH/USDT via the Feed Registry.");
check(!ref.stale, `ETH/USDT ${ref.price.toFixed(2)} (updated ${Math.round((Date.now() - ref.updatedAt) / 60000)} min ago, ${ref.history.length} points in 24h)`);
const P = Math.round(ref.price);

// ── 5. Fund traders with real WETH and real USDT ──────────────────────────────
console.log("\n[4] Funding test traders on the fork");
const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
] as const;
const bal = (t: Hex, who: string) => pub.readContract({ address: t, abi: erc20, functionName: "balanceOf", args: [who as Hex] }) as Promise<bigint>;
const tx = async (a: any, address: Hex, functionName: "approve" | "deposit", args: any[], value?: bigint) =>
  pub.waitForTransactionReceipt({ hash: await wallet(a).writeContract({ address, abi: erc20, functionName, args, value } as any) });
// USDT balances live in a mapping; find its storage slot, then write balances directly
async function setUsdt(who: string, amount: bigint) {
  for (let slot = 0; slot < 12; slot++) {
    const key = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [who as Hex, BigInt(slot)]));
    const prev = await pub.getStorageAt({ address: USDT, slot: key });
    await pub.request({ method: "anvil_setStorageAt" as any, params: [USDT, key, pad(toHex(amount))] as any });
    if (await bal(USDT, who) === amount) return;
    await pub.request({ method: "anvil_setStorageAt" as any, params: [USDT, key, prev ?? pad("0x0")] as any });
  }
  fail("Couldn't locate USDT's balance slot");
}
for (const a of [alice, bob, mallory]) {
  await tx(a, WETH, "deposit", [], parseUnits("1", 18));
  await setUsdt(a.address, parseUnits("10000", 6));
  await tx(a, WETH, "approve", [settlement, maxUint256]);
  await tx(a, USDT, "approve", [settlement, maxUint256]);
}
check(await bal(USDT, bob.address) === parseUnits("10000", 6) && await bal(WETH, alice.address) >= parseUnits("1", 18), "3 traders with 1 WETH and 10,000 USDT each, approvals set (USDT's quirky approve worked)");

// ── 6. Trades through the real code paths ─────────────────────────────────────
const store: any[] = [];
const put = (o: any) => store.push(o);
async function order(acct: any, side: "buy" | "sell", amount: string, px: number, opts: { receiveNative?: boolean; fills?: boolean } = {}) {
  const st = await A.deriveState(store);
  const limit = A.toPrice(m, String(px)), base = A.toBaseUnits(m, amount);
  const mt = A.matchOrder({ book: st.orders, market: m, side, amount: base, limit, me: acct.address });
  const sideNum = side === "buy" ? cfg.SIDE_BUY_BASE : cfg.SIDE_SELL_BASE;
  const auth = A.buildAuthMessage({ market: m, grantor: acct.address, side: sideNum, baseAmount: base, limitPrice: limit, maxFee: side === "buy" ? A.maxFeeForOrder(A.quoteFor(base, limit), cfg.EXECUTOR_FEE_BPS) : 0n, ttlSecs: 3600 });
  const authObj = A.authObject(fin, auth, await acct.signTypedData({ domain: cfg.getEvmSpotDomain(), types: cfg.AUTH_TYPES, primaryType: "TradingSessionAuthorization", message: A.authForSigning(auth) }));
  const counterSet = mt.legs.map((l: any) => ({ orderHash: l.order.orderEip712, maxBase: l.base }));
  const o = A.buildOrderMessage({ market: m, trader: acct.address, side: sideNum, price: limit, baseAmount: base, auth, receiveNative: opts.receiveNative,
    counterSet, exclusiveBase: mt.filled, exclusiveUntil: Number((await pub.getBlock()).timestamp) + cfg.EXCLUSIVE_WINDOW_SECS });
  const orderObj = A.orderObject(fin, authObj.objectHash, o, await acct.signTypedData({ domain: cfg.getEvmSpotDomain(), types: cfg.ORDER_TYPES, primaryType: "SignedOrder", message: A.orderForSigning(o) }), counterSet);
  put(authObj); put(orderObj);
  if (opts.fills !== false) for (const leg of mt.legs) put(A.fillObject(fin, { makerAuthHash: leg.order.authObj.objectHash, takerAuthHash: authObj.objectHash, makerOrderHash: leg.order.orderObj.objectHash, takerOrderHash: orderObj.objectHash, price: leg.price, baseAmount: leg.base, executorFee: side === "buy" ? A.feeForQuote(leg.quote, cfg.EXECUTOR_FEE_BPS) : 0n }));
  return { mt, authObj, orderObj };
}
const gasUsed: bigint[] = [];
async function runExecutor() {
  const valid: any[] = [];
  for (const o of store) { try { await ns.validateObject!(o); valid.push(o); } catch {} }
  let n = 0;
  for (const g of ns.evaluate(valid).filter((g: any) => g.status === "executable")) {
    try { const r: any = await ns.execute!(g, { mode: "contract" }); put(r.receiptObject); n++;
      gasUsed.push((await pub.getTransactionReceipt({ hash: r.receiptObject.payload.executionTx })).gasUsed); } catch (e: any) { console.log("    executor:", e?.shortMessage ?? e?.message); }
  }
  return n;
}
const byHash = (h: string) => store.find(o => o.objectHash === h);
const authS = (o: any) => { const a = o.payload.authorization; return { ...a, sideMask: Number(a.sideMask), maxBaseExposure: BigInt(a.maxBaseExposure), maxQuoteExposure: BigInt(a.maxQuoteExposure), maxExecutorFeeQuote: BigInt(a.maxExecutorFeeQuote), minPrice: BigInt(a.minPrice), maxPrice: BigInt(a.maxPrice), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) }; };
const ordS = (o: any) => { const x = o.payload.order; return { ...x, side: Number(x.side), price: BigInt(x.price), baseAmount: BigInt(x.baseAmount), validAfter: BigInt(x.validAfter), validBefore: BigInt(x.validBefore), exclusiveBase: BigInt(x.exclusiveBase), exclusiveUntil: BigInt(x.exclusiveUntil) }; };
const legsOf = (o: any) => (o.payload.counterSet ?? []).map((l: any) => ({ orderHash: l.orderHash, maxBase: BigInt(l.maxBase) }));
async function directSettle(mk: any, tk: any, price: bigint, base: bigint) {
  const mA = byHash(mk.references[0]), tA = byHash(tk.references[0]);
  const data = encodeFunctionData({ abi, functionName: "settleSpotTrade", args: [
    authS(mA), mA.signature.signature, ordS(mk), mk.signature.signature, authS(tA), tA.signature.signature, ordS(tk), tk.signature.signature,
    { makerOrderHash: A.orderEip712(mk.payload.order), takerOrderHash: A.orderEip712(tk.payload.order), makerAuthHash: mk.payload.order.sessionAuthHash, takerAuthHash: tk.payload.order.sessionAuthHash,
      price, baseAmount: base, quoteAmount: A.quoteFor(base, price), executorFeeQuoteAmount: 0n, fillNonce: A.randomHex32(),
      makerCounterSet: legsOf(mk), takerCounterSet: legsOf(tk) }] });
  try { await pub.call({ to: settlement, data, account: mallory.address }); return "OK"; }
  catch (e: any) {
    // The revert data can sit at different depths of viem's error chain
    let hex: string | undefined;
    for (let x = e; x && !hex; x = x.cause) {
      const d = x.data ?? x.details;
      if (typeof d === "string" && /^0x[0-9a-fA-F]{8,}$/.test(d)) hex = d;
      else if (typeof d?.data === "string") hex = d.data;
      else { const mm = String(x.details ?? x.message ?? "").match(/0x[0-9a-fA-F]{8,}/); if (mm && /revert|custom error/i.test(String(x.details ?? x.message))) hex = mm[0]; }
    }
    try { return decodeErrorResult({ abi, data: hex as Hex }).errorName; } catch {}
    // Some RPC paths only expose the 4-byte selector; match it against the ABI
    const sel = (hex ?? "").slice(0, 10).toLowerCase();
    for (const item of abi as any[]) {
      if (item.type !== "error") continue;
      const sig = `${item.name}(${item.inputs.map((i: any) => i.type).join(",")})`;
      if (keccak256(toHex(sig)).slice(0, 10) === sel) return item.name;
    }
    return `REVERTED(${hex ?? e?.shortMessage ?? "?"})`;
  }
}

console.log(`\n[5] Trading at ~${P} USDT/ETH`);
await order(alice, "sell", "0.01", P);
await order(alice, "sell", "0.01", P + 1);
const bobEth0 = await pub.getBalance({ address: bob.address }), bobU0 = await bal(USDT, bob.address), aliceU0 = await bal(USDT, alice.address), exU0 = await bal(USDT, executor.address);
const bob1 = await order(bob, "buy", "0.025", P + 5, { receiveNative: true });
check(bob1.mt.legs.length === 2 && bob1.mt.remainder === parseUnits("0.005", 18), "Bob's limit buy sweeps two price levels and leaves 0.005 resting");

const mal = await order(mallory, "sell", "0.02", P + 5, { fills: false });
const fr = await directSettle(mal.orderObj, bob1.orderObj, A.toPrice(m, String(P + 5)), parseUnits("0.02", 18));
check(fr === "CounterpartyNotAllowed", `front-running attempt at Bob's limit is rejected by the contract${fr === "CounterpartyNotAllowed" ? "" : ` (got ${fr})`}`);

check(await runExecutor() === 2, "the real executor code settles both fills");
const expectQuote = A.quoteFor(parseUnits("0.01", 18), A.toPrice(m, String(P))) + A.quoteFor(parseUnits("0.01", 18), A.toPrice(m, String(P + 1)));
check((await pub.getBalance({ address: bob.address })) - bobEth0 === parseUnits("0.02", 18), "Bob received 0.02 native ETH (no gas spent by him)");
const expectFee = A.feeForQuote(A.quoteFor(parseUnits("0.01", 18), A.toPrice(m, String(P))), 10n) + A.feeForQuote(A.quoteFor(parseUnits("0.01", 18), A.toPrice(m, String(P + 1))), 10n);
check(bobU0 - (await bal(USDT, bob.address)) === expectQuote + expectFee, `Bob paid ${formatUnits(expectQuote, 6)} USDT at the book prices plus a 0.1% executor fee`);
check((await bal(USDT, alice.address)) - aliceU0 === expectQuote, "Alice received the USDT");
check((await bal(USDT, executor.address)) - exU0 === expectFee, "the executor collected its fees");
check(await bal(WETH, settlement) === 0n && await pub.getBalance({ address: settlement }) === 0n, "the contract holds nothing afterwards");

console.log("\n[6] A buyer wallet that refuses ETH gets WETH instead (real WETH9)");
const rejectRuntime = out2.contracts["RejectEth.sol"].RejectEth.evm.deployedBytecode.object;
const carol = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
await pub.request({ method: "anvil_setBalance" as any, params: [carol.address, toHex(parseUnits("10", 18))] as any });
await setUsdt(carol.address, parseUnits("1000", 6));
await tx(carol, USDT, "approve", [settlement, maxUint256]);
await pub.request({ method: "anvil_setCode" as any, params: [carol.address, `0x${rejectRuntime}`] as any }); // now a wallet that rejects ETH
await order(alice, "sell", "0.01", P + 20);
const carolW0 = await bal(WETH, carol.address);
const c1 = await order(carol, "buy", "0.01", P + 20, { receiveNative: true });
check(c1.mt.legs.length === 1 && await runExecutor() === 1, "the trade settles");
check((await bal(WETH, carol.address)) - carolW0 === parseUnits("0.01", 18), "the buyer received 0.01 WETH through the fallback");
check(await bal(WETH, settlement) === 0n && await pub.getBalance({ address: settlement }) === 0n, "nothing is left in the contract");

console.log("\n[7] On-chain cancel");
const a = authS(byHash(bob1.orderObj.references[0]));
await pub.waitForTransactionReceipt({ hash: await wallet(bob).writeContract({ address: settlement, abi, functionName: "revokeAuthorization", args: [a] } as any) });
check(await directSettle(mal.orderObj, bob1.orderObj, A.toPrice(m, String(P + 5)), parseUnits("0.005", 18)) !== "OK", "after Cancel on-chain, nobody can settle Bob's remainder");

// ── 8. Gas ────────────────────────────────────────────────────────────────────
console.log("\n[8] Cost");
const gp = await pub.getGasPrice();
const avg = gasUsed.reduce((x, y) => x + y, 0n) / BigInt(gasUsed.length);
const ethCost = Number(formatUnits(avg * gp, 18));
console.log(`  settlement gas ${avg.toLocaleString()} × ${Number(formatUnits(gp, 9)).toFixed(2)} gwei = ${ethCost.toFixed(6)} ETH ≈ ${(ethCost * ref.price).toFixed(2)} USDT per fill (paid by the executor)`);
console.log(`  deployment gas ${drc.gasUsed.toLocaleString()} ≈ ${Number(formatUnits(drc.gasUsed * gp, 18)).toFixed(5)} ETH at today's price`);

cleanup();
console.log(`
All ${pass} checks passed.

Deploy with exactly these settings:
  Compiler      solc ${COMPILER.version}
  Optimizer     enabled, ${COMPILER.optimizer.runs} runs
  viaIR         true
  EVM version   ${COMPILER.evmVersion}
  Constructor   ${WETH}  (mainnet WETH)
`);
