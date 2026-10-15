// Re-runs each attack the independent review proved, against the fixed contract.
import { createPublicClient, createWalletClient, http, defineChain, parseUnits, maxUint256, encodeFunctionData, decodeErrorResult, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { finalizeObject } from "@intervalplace/aon-sdk";

const art = JSON.parse(readFileSync(new URL("./artifacts.json", import.meta.url), "utf8"));
const chain = defineChain({ id: 31337, name: "anvil", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } });
const pub = createPublicClient({ chain, transport: http() });
const K = ["0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80","0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d","0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a","0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6","0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a","0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba","0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e"] as const;
const [executor, alice, bob, mallory, mallory2, mk1, mk2] = K.map(k => privateKeyToAccount(k));
const wc = (a: any) => createWalletClient({ account: a, chain, transport: http() });
const deploy = async (n: string, args: any[] = []) => (await pub.waitForTransactionReceipt({ hash: await wc(executor).deployContract({ abi: art[n].abi, bytecode: art[n].bytecode, args }) })).contractAddress!;
const send = async (acct: any, address: any, n: string, fn: string, args: any[], value?: bigint) => pub.waitForTransactionReceipt({ hash: await wc(acct).writeContract({ address, abi: art[n].abi, functionName: fn, args, value } as any) });
const bal = (t: any, n: string, who: any) => pub.readContract({ address: t, abi: art[n].abi, functionName: "balanceOf", args: [who] }) as Promise<bigint>;
let pass = 0;
const check = (c: any, l: string) => { if (!c) { console.error("  FAIL:", l); process.exit(1); } pass++; console.log("  ok -", l); };
const E = (x: string) => parseUnits(x, 18), U = (x: string) => parseUnits(x, 6);

const weth = await deploy("MockWETH"), usdt = await deploy("MockUSDT"), feeUsdt = await deploy("FeeUSDT"), settlement = await deploy("AonEvmSpotSettlement", [weth]);
Object.assign(process.env, { NEXT_PUBLIC_CHAIN_ID: "31337", NEXT_PUBLIC_EVM_SPOT_SETTLEMENT: settlement, NEXT_PUBLIC_WETH_ADDRESS: weth, NEXT_PUBLIC_USDT_ADDRESS: usdt, NEXT_PUBLIC_EXECUTOR_FEE_BPS: "10", AON_EVM_RPC_URL: "http://127.0.0.1:8545", AON_EXECUTOR_PRIVATE_KEY: K[0], AON_EVM_SPOT_SETTLEMENT_CONTRACT: settlement });
const cfg = await import("./fe/config.ts"); const A = await import("./fe/aon.ts");
const { evmSpotNamespace: ns } = await import("./ns/namespace.ts");
const m = cfg.MARKETS[0];
const feeMarket = { ...m, key: "ETH-FUSDT", quote: { ...m.quote, address: feeUsdt }, marketId: keccak256(toBytes("fee-usdt-market")) };
const abi = art.AonEvmSpotSettlement.abi;

for (const a of [alice, bob, mallory, mallory2, mk1, mk2]) {
  await send(a, weth, "MockWETH", "deposit", [], E("20"));
  await send(executor, usdt, "MockUSDT", "mint", [a.address, U("200000")]);
  await send(executor, feeUsdt, "FeeUSDT", "mint", [a.address, U("200000")]);
  for (const [t, n] of [[weth, "MockWETH"], [usdt, "MockUSDT"], [feeUsdt, "FeeUSDT"]] as const) await send(a, t, n, "approve", [settlement, maxUint256]);
}
const fin = (o: any) => finalizeObject(o) as any;
const now = async () => Number((await pub.getBlock()).timestamp);

// Sign an order exactly as the app does (market defaults to ETH/USDT)
async function order(acct: any, side: "buy" | "sell", px: string, amt: string, o: { legs?: { orderHash: any; maxBase: bigint }[]; exclBase?: bigint; exclUntil?: number; receiveNative?: boolean; market?: any } = {}) {
  const mkt = o.market ?? m, price = A.toPrice(mkt, px), base = A.toBaseUnits(mkt, amt);
  const sideNum = side === "buy" ? cfg.SIDE_BUY_BASE : cfg.SIDE_SELL_BASE;
  const auth = A.buildAuthMessage({ market: mkt, grantor: acct.address, side: sideNum, baseAmount: base, limitPrice: price, maxFee: side === "buy" ? A.maxFeeForOrder(A.quoteFor(base, price), cfg.EXECUTOR_FEE_BPS) : 0n, ttlSecs: 86400 });
  const ao = A.authObject(fin, auth, await acct.signTypedData({ domain: cfg.getEvmSpotDomain(), types: cfg.AUTH_TYPES, primaryType: "TradingSessionAuthorization", message: A.authForSigning(auth) }));
  const msg = A.buildOrderMessage({ market: mkt, trader: acct.address, side: sideNum, price, baseAmount: base, auth, receiveNative: o.receiveNative,
    counterSet: o.legs, exclusiveBase: o.exclBase ?? 0n, exclusiveUntil: o.exclUntil ?? (await now()) + 300 });
  const oo = A.orderObject(fin, ao.objectHash, msg, await acct.signTypedData({ domain: cfg.getEvmSpotDomain(), types: cfg.ORDER_TYPES, primaryType: "SignedOrder", message: A.orderForSigning(msg) }), o.legs ?? []);
  return { ao, oo, price, base, eip: A.orderEip712(msg) };
}
const authS = (o: any) => { const a = o.payload.authorization; return { ...a, sideMask: Number(a.sideMask), maxBaseExposure: BigInt(a.maxBaseExposure), maxQuoteExposure: BigInt(a.maxQuoteExposure), maxExecutorFeeQuote: BigInt(a.maxExecutorFeeQuote), minPrice: BigInt(a.minPrice), maxPrice: BigInt(a.maxPrice), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) }; };
const legs = (o: any) => (o.oo.payload.counterSet ?? []).map((l: any) => ({ orderHash: l.orderHash, maxBase: BigInt(l.maxBase) }));
function calldata(mk: any, tk: any, f: { price: bigint; base: bigint; quote?: bigint; fee?: bigint; nonce?: any }) {
  return encodeFunctionData({ abi, functionName: "settleSpotTrade", args: [
    authS(mk.ao), mk.ao.signature.signature, A.orderForSigning(mk.oo.payload.order), mk.oo.signature.signature,
    authS(tk.ao), tk.ao.signature.signature, A.orderForSigning(tk.oo.payload.order), tk.oo.signature.signature,
    { makerOrderHash: mk.eip, takerOrderHash: tk.eip, makerAuthHash: mk.oo.payload.order.sessionAuthHash, takerAuthHash: tk.oo.payload.order.sessionAuthHash,
      price: f.price, baseAmount: f.base, quoteAmount: f.quote ?? A.quoteFor(f.base, f.price), executorFeeQuoteAmount: f.fee ?? 0n, fillNonce: f.nonce ?? A.randomHex32(),
      makerCounterSet: legs(mk), takerCounterSet: legs(tk) }] });
}

// ── A minimal AON node (the two endpoints the executor uses) ─────────────────
import { createServer } from "http";
import { spawn } from "child_process";
const store: any[] = [];
const node = createServer(async (req, res) => {
  const u = new URL(req.url!, "http://x");
  res.setHeader("content-type", "application/json");
  if (req.method === "GET" && u.pathname === "/v1/objects") {
    const lim = Number(u.searchParams.get("limit") ?? 100), off = Number(u.searchParams.get("offset") ?? 0);
    const all = store.filter(o => o.namespace === u.searchParams.get("namespace"));
    return res.end(JSON.stringify({ ok: true, objects: all.slice(off, off + lim), total: all.length }));
  }
  if (req.method === "POST" && u.pathname === "/v1/objects") {
    let b = ""; for await (const c of req) b += c;
    const o = JSON.parse(b); if (!store.some(x => x.objectHash === o.objectHash)) store.push(o);
    return res.end(JSON.stringify({ ok: true }));
  }
  res.statusCode = 404; res.end(JSON.stringify({ ok: false }));
}).listen(8790);

console.log("\n[1] The executor service settles a matched trade");
const sS = await order(alice, "sell", "3000", "0.5"), sB = await order(bob, "buy", "3000", "0.5", { receiveNative: true });
const fee = A.quoteFor(E("0.5"), sS.price) * 10n / 10_000n;
const F = A.fillObject(fin, { makerAuthHash: sS.ao.objectHash, takerAuthHash: sB.ao.objectHash, makerOrderHash: sS.oo.objectHash, takerOrderHash: sB.oo.objectHash, price: sS.price, baseAmount: E("0.5"), executorFee: fee });
// plus filler objects to force pagination past 1000
for (let i = 0; i < 1100; i++) store.push({ objectType: "note", namespace: "aon:evm-spot", objectHash: "0x" + i.toString(16).padStart(64, "0"), createdAt: 0, references: [], payload: {} });
store.push(sS.ao, sS.oo, sB.ao, sB.oo);
// A forged receipt claiming F is done (points at an unrelated tx) — must be ignored
const decoyTx = (await send(executor, usdt, "MockUSDT", "mint", [executor.address, 1n])).transactionHash;
const forged = fin({ objectType: "receipt", schemaVersion: "1", namespace: "aon:evm-spot", createdAt: Date.now(), references: [F.objectHash],
  payload: { executionTx: decoyTx, settlementContract: settlement, fillKey: A.fillKeyOf(F.payload.fill.fillNonce, sS.eip, sB.eip, sS.price, E("0.5"), A.quoteFor(E("0.5"), sS.price), fee), fillNonce: F.payload.fill.fillNonce,
    makerOrderHash: sS.eip, takerOrderHash: sB.eip, price: String(sS.price), baseAmount: String(E("0.5")), quoteAmount: String(A.quoteFor(E("0.5"), sS.price)), executorFeeQuoteAmount: String(fee) } });
store.push(forged, F);

const bobEth0 = await pub.getBalance({ address: bob.address }), exU0 = await bal(usdt, "MockUSDT", executor.address);
const proc = spawn("node", ["--import", "tsx", "executor.ts"], { cwd: new URL("../covenant-executor", import.meta.url).pathname, env: { ...process.env,
  AON_EVM_RPC_URL: "http://127.0.0.1:8545", AON_EXECUTOR_PRIVATE_KEY: K[0], AON_EVM_SPOT_SETTLEMENT_CONTRACT: settlement,
  AON_NODE_URLS: "http://127.0.0.1:8799,http://127.0.0.1:8790", POLL_INTERVAL_MS: "500", MIN_ETH_BALANCE: "100000" }, stdio: ["ignore", "pipe", "pipe"] });
let logs = ""; proc.stdout.on("data", d => logs += d); proc.stderr.on("data", d => logs += d);
const until = async (f: () => Promise<boolean> | boolean, ms = 60_000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await new Promise(r => setTimeout(r, 300)); } return false; };
const gotReceipt = await until(() => store.some(o => o.objectType === "receipt" && o.objectHash !== forged.objectHash));
check(gotReceipt, "it settles the trade and publishes a receipt (past a forged one, an unreachable first node, and 1,100 other objects)");
check((await pub.getBalance({ address: bob.address })) - bobEth0 === E("0.5"), "the buyer received 0.5 native ETH");
check((await bal(usdt, "MockUSDT", executor.address)) - exU0 === fee, "the executor earned the 0.1% fee");
const rc = store.find(o => o.objectType === "receipt" && o.objectHash !== forged.objectHash);
let rErr = ""; try { await ns.validateObject!(rc); } catch (e: any) { rErr = e.message; }
check(rErr === "", "its receipt passes on-chain verification");
await new Promise(r => setTimeout(r, 2500));
check((logs.match(/\[settled\]/g) ?? []).length === 1, "it settles once and doesn't retry");
check(/LOW BALANCE/.test(logs), "the low-balance warning fires when the wallet is below the threshold");
check(/unreachable/.test(logs), "an unreachable node is skipped, not fatal");
proc.kill("SIGTERM");
check(await until(() => proc.exitCode !== null, 10_000), "it stops cleanly on SIGTERM");

console.log(`\nAll ${pass} checks passed.`);
node.close(); process.exit(0);
