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
async function attempt(data: string, from = executor) {
  try { await pub.call({ to: settlement, data: data as any, account: from.address }); }
  catch (e: any) {
    let hex: string | undefined;
    for (let x = e; x && !hex; x = x.cause) { const d = x.data; if (typeof d === "string" && d.startsWith("0x")) hex = d; else if (typeof d?.data === "string") hex = d.data; }
    try { return decodeErrorResult({ abi, data: hex as any }).errorName; } catch { return "REVERTED"; }
  }
  const h = await wc(from).sendTransaction({ to: settlement, data: data as any, gas: 2_000_000n });
  const rc = await pub.waitForTransactionReceipt({ hash: h });
  return rc.status === "success" ? "OK" : "REVERTED";
}

const fwc = (o: any, c: any) => pub.readContract({ address: settlement, abi, functionName: "filledWithCounterparty", args: [o.eip, c.eip] }) as Promise<bigint>;
const fbo = (o: any) => pub.readContract({ address: settlement, abi, functionName: "filledBaseByOrder", args: [o.eip] }) as Promise<bigint>;
console.log("\n[H] Reusing a pending trade's fill nonce no longer blocks or fakes it");
const vS = await order(alice, "sell", "3000", "0.5"), vB = await order(bob, "buy", "3000", "0.5");
const vFill = A.fillObject(fin, { makerAuthHash: vS.ao.objectHash, takerAuthHash: vB.ao.objectHash, makerOrderHash: vS.oo.objectHash, takerOrderHash: vB.oo.objectHash, price: vS.price, baseAmount: vS.base, executorFee: 0n });
const N = vFill.payload.fill.fillNonce;
const aS = await order(mallory, "sell", "3000", "0.001"), aB = await order(mallory2, "buy", "3000", "0.001");
const atkTx = await wc(executor).sendTransaction({ to: settlement, data: calldata(aS, aB, { price: aS.price, base: aS.base, nonce: N }) as any });
check((await pub.waitForTransactionReceipt({ hash: atkTx })).status === "success", "the attacker's tiny trade reusing the victim's nonce settles (it's their own trade)");
const store: any[] = [vS.ao, vS.oo, vB.ao, vB.oo, vFill];
const valid = async () => { const v: any[] = []; for (const o of store) { try { await ns.validateObject!(o); v.push(o); } catch {} } return v; };
const victimExecutable = async () => ns.evaluate(await valid()).some((g: any) => g.status === "executable" && g.fill.objectHash === vFill.objectHash);
const atkKey = A.fillKeyOf(N, aS.eip, aB.eip, aS.price, aS.base, A.quoteFor(aS.base, aS.price), 0n);
const fakeA = fin({ objectType: "receipt", schemaVersion: "1", namespace: "aon:evm-spot", createdAt: Date.now(), references: [vFill.objectHash],
  payload: { executionTx: atkTx, settlementContract: settlement, fillKey: A.fillKeyOf(N, vS.eip, vB.eip, vS.price, vS.base, A.quoteFor(vS.base, vS.price), 0n), fillNonce: N, makerOrderHash: vS.eip, takerOrderHash: vB.eip,
    price: String(vS.price), baseAmount: String(vS.base), quoteAmount: String(A.quoteFor(vS.base, vS.price)), executorFeeQuoteAmount: "0" } });
let errA = ""; try { await ns.validateObject!(fakeA); } catch (e: any) { errA = e.message; }
check(errA === "RECEIPT_EVENT_NOT_FOUND", "a fake receipt claiming the victim's trade with the attacker's tx is rejected on-chain");
const fakeB = fin({ objectType: "receipt", schemaVersion: "1", namespace: "aon:evm-spot", createdAt: Date.now(), references: [vFill.objectHash],
  payload: { executionTx: atkTx, settlementContract: settlement, fillKey: atkKey, fillNonce: N, makerOrderHash: aS.eip, takerOrderHash: aB.eip,
    price: String(aS.price), baseAmount: String(aS.base), quoteAmount: String(A.quoteFor(aS.base, aS.price)), executorFeeQuoteAmount: "0" } });
let errB = ""; try { await ns.validateObject!(fakeB); } catch (e: any) { errB = e.message; }
check(errB === "", "a receipt honestly describing the attacker's own trade passes on-chain checks…");
store.push(fakeA, fakeB);
check(await victimExecutable(), "…but neither receipt marks the victim's trade done: the executor still sees it as executable");
check(await attempt(calldata(vS, vB, { price: vS.price, base: vS.base, nonce: N })) === "OK", "and the victim's trade settles despite the reused nonce");

console.log("\n[M] With several named counterparties, the executor can't pick the mix");
const m1 = await order(mk1, "sell", "3000", "1"), m2 = await order(mk2, "sell", "3050", "5");
const sweeper = await order(bob, "buy", "3050", "2", { legs: [{ orderHash: m1.eip, maxBase: E("1") }, { orderHash: m2.eip, maxBase: E("1") }], exclBase: E("2") });
check(await attempt(calldata(m2, sweeper, { price: m2.price, base: E("2") })) === "OK" && await fwc(sweeper, m2) === E("1"), "routing all 2 ETH to the 3050 counterparty settles only the 1 the buyer signed for from it");
check(await attempt(calldata(m2, sweeper, { price: m2.price, base: E("0.1") })) === "CounterLegExceeded", "…and nothing more from it after that");
check(await attempt(calldata(m1, sweeper, { price: m1.price, base: E("1") })) === "OK", "the 3000 counterparty's 1 ETH is still there for the buyer");

console.log("\n[M] A dust fill can't take the buyer's fee budget");
const fb = await order(bob, "buy", "3000", "1"), fs = await order(alice, "sell", "3000", "1");
const cap = BigInt(fb.ao.payload.authorization.maxExecutorFeeQuote);
check(await attempt(calldata(fs, fb, { price: fs.price, base: E("0.000001"), fee: cap })) === "ExecutorFeeTooHigh", `a 0.000001 ETH fill claiming the whole ${Number(cap) / 1e6} USDT fee cap is rejected`);
check(await attempt(calldata(fs, fb, { price: fs.price, base: E("0.5"), fee: A.feeForQuote(A.quoteFor(E("0.5"), fs.price), 10n) })) === "OK", "a fair 0.1% fee on a normal fill is accepted");

console.log("\n[M] If USDT ever charges a transfer fee, sellers aren't shortchanged");
const ffS = await order(alice, "sell", "3000", "0.1", { market: feeMarket }), ffB = await order(bob, "buy", "3000", "0.1", { market: feeMarket });
check(await attempt(calldata(ffS, ffB, { price: ffS.price, base: ffS.base })) === "ReceivedLessThanSigned", "with a 0.2% token fee on, the trade reverts instead of paying the seller less than they signed");

console.log("\n[L] Zero-value fills");
const zS = await order(alice, "sell", "3000", "1"), zB = await order(bob, "buy", "3000", "1");
check(await attempt(calldata(zS, zB, { price: zS.price, base: 1n })) === "ZeroAmount", "a fill so small it rounds to 0 USDT is rejected");

console.log("\n[L] Hostile buyer wallets can't stall or burn the executor");
async function delegate(acct: any, to: any) {
  const auth = await wc(acct).signAuthorization({ contractAddress: to, executor: "self" } as any);
  await pub.waitForTransactionReceipt({ hash: await wc(acct).sendTransaction({ to: executor.address, data: "0x", authorizationList: [auth] } as any) });
}
for (const [label, mock] of [["refuses ETH", "RejectEth"], ["burns all gas it's given", "GasBurner"]] as const) {
  const who = mallory2; await delegate(who, await deploy(mock));
  const hS = await order(alice, "sell", "3000", "0.2"), hB = await order(who, "buy", "3000", "0.2", { receiveNative: true });
  const w0 = await bal(weth, "MockWETH", who.address);
  const h = await wc(executor).sendTransaction({ to: settlement, data: calldata(hS, hB, { price: hS.price, base: hS.base }) as any, gas: 2_000_000n });
  const rc = await pub.waitForTransactionReceipt({ hash: h });
  check(rc.status === "success" && (await bal(weth, "MockWETH", who.address)) - w0 === E("0.2"), `a buyer wallet that ${label}: the trade still settles and they get WETH instead`);
  check(rc.gasUsed < 450_000n, `…using ${rc.gasUsed.toLocaleString()} gas (bounded)`);
  await delegate(who, "0x0000000000000000000000000000000000000000");
}

console.log("\n[+] Self-trades");
const sS = await order(mallory, "sell", "3000", "0.1"), sB = await order(mallory, "buy", "3000", "0.1");
check(await attempt(calldata(sS, sB, { price: sS.price, base: sS.base })) === "ReceivedLessThanSigned", "trading with yourself reverts on-chain (no wash trades)");

console.log("\n[I] Signatures don't carry over to a forked chain");
const cS = await order(alice, "sell", "3000", "0.1"), cB = await order(bob, "buy", "3000", "0.1");
const cd = calldata(cS, cB, { price: cS.price, base: cS.base });
await pub.request({ method: "anvil_setChainId" as any, params: [999] as any });
const forked = await attempt(cd);
await pub.request({ method: "anvil_setChainId" as any, params: [31337] as any });
check(forked !== "OK", `on a chain with a different id, the same signed trade is rejected (${forked})`);
check(await attempt(cd) === "OK", "back on the original chain it's valid");

console.log("\n[R2-H] Reusing a nonce with the same orders and a dust size doesn't burn the honest fill");
const dS = await order(alice, "sell", "3000", "0.5"), dB = await order(bob, "buy", "3000", "0.5");
const dFill = A.fillObject(fin, { makerAuthHash: dS.ao.objectHash, takerAuthHash: dB.ao.objectHash, makerOrderHash: dS.oo.objectHash, takerOrderHash: dB.oo.objectHash, price: dS.price, baseAmount: dS.base, executorFee: 0n });
const dN = dFill.payload.fill.fillNonce;
check(await attempt(calldata(dS, dB, { price: dS.price, base: E("0.001"), nonce: dN })) === "OK", "a dust fill of the same orders with the same nonce settles (it's within both orders' terms)");
const honestKey = A.fillKeyOf(dN, dS.eip, dB.eip, dS.price, dS.base, A.quoteFor(dS.base, dS.price), 0n);
check((await pub.readContract({ address: settlement, abi, functionName: "usedFill", args: [honestKey] })) === false, "…but the honest fill's key is untouched (no FillReplay)");
const dState = await A.deriveState([dS.ao, dS.oo, dB.ao, dB.oo, dFill], { filled: new Map([[dS.eip.toLowerCase(), E("0.001")], [dB.eip.toLowerCase(), E("0.001")]]), usedFills: new Set() });
check(dState.fills[0].status !== "settled" && dState.orders.find(o => o.orderObj.objectHash === dS.oo.objectHash)!.filled === E("0.001"), "and the interface shows only the 0.001 that actually moved, not the honest fill as settled");
const bM = await order(mk2, "sell", "3000", "0.4");
const bV = await order(mallory2, "buy", "3000", "0.4", { legs: [{ orderHash: bM.eip, maxBase: E("0.4") }], exclBase: E("0.4") });
check(await attempt(calldata(bM, bV, { price: bM.price, base: E("0.001") })) === "OK", "a dust piece of a named leg can settle, but only with that counterparty at its price (nothing to steal)");
check(await attempt(calldata(bM, bV, { price: bM.price, base: E("0.4") })) === "OK" && await fwc(bV, bM) === E("0.4"), "…and the leg's signed total still caps it: the full 0.4 on top settles only the 0.399 left");
check(await attempt(calldata(bM, bV, { price: bM.price, base: E("0.001") })) === "CounterLegExceeded", "nothing more after that");

console.log("\n[R3-M] Dusting the named counterparty doesn't break the matched trade");
const qM = await order(mk1, "sell", "3000", "0.5");
const qV = await order(bob, "buy", "3000", "0.5", { legs: [{ orderHash: qM.eip, maxBase: E("0.5") }], exclBase: E("0.5") });
const qFee = A.quoteFor(E("0.5"), qM.price) * 10n / 10_000n; // 0.1%
const qFill = A.fillObject(fin, { makerAuthHash: qM.ao.objectHash, takerAuthHash: qV.ao.objectHash, makerOrderHash: qM.oo.objectHash, takerOrderHash: qV.oo.objectHash, price: qM.price, baseAmount: E("0.5"), executorFee: qFee });
const duster = await order(mallory, "buy", "3000", "0.001");
check(await attempt(calldata(qM, duster, { price: qM.price, base: E("0.001") })) === "OK", "an attacker takes 0.001 of the named ask first");
const qstore: any[] = [qM.ao, qM.oo, qV.ao, qV.oo, qFill];
const qvalid = async () => { const v: any[] = []; for (const o of qstore) { try { await ns.validateObject!(o); v.push(o); } catch {} } return v; };
const qg = ns.evaluate(await qvalid()).find((g: any) => g.status === "executable" && g.fill.objectHash === qFill.objectHash);
check(!!qg, "the executor still sees the matched 0.5 fill as executable");
const exU0 = await bal(usdt, "MockUSDT", executor.address);
let qr: any = null; try { qr = await ns.execute!(qg, { mode: "contract" }); } catch (e: any) { console.error(e?.shortMessage ?? e?.message); }
check(!!qr && await fbo(qV) === E("0.499"), "the executor's unchanged fill settles what's left (0.499) instead of reverting");
check((await bal(usdt, "MockUSDT", executor.address)) - exU0 === qFee * E("0.499") / E("0.5"), "the executor fee scales down with it");
check(qr?.receiptObject?.payload?.baseAmount === String(E("0.499")) && qr?.receiptObject?.payload?.quoteAmount === String(A.quoteFor(E("0.499"), qM.price)), "its receipt reports the 0.499 that moved");
let qErr = ""; try { await ns.validateObject!(qr.receiptObject); } catch (e: any) { qErr = e.message; }
check(qErr === "", "…and that receipt passes on-chain verification");
qstore.push(qr.receiptObject);
check(!ns.evaluate(await qvalid()).some((g: any) => g.status === "executable"), "afterwards the executor has nothing left to retry");
check(A.deriveState !== undefined && (await A.deriveState(qstore)).fills.find((f: any) => f.fillHash === qFill.objectHash)?.baseAmount === E("0.499"), "the interface shows 0.499 traded, not 0.5");
const qKey = A.fillKeyOf(qFill.payload.fill.fillNonce, qM.eip, qV.eip, qM.price, E("0.5"), A.quoteFor(E("0.5"), qM.price), qFee).toLowerCase();
const noRcpt = await A.deriveState(qstore.filter((o: any) => o.objectType !== "receipt"), { filled: new Map([[qM.eip.toLowerCase(), await fbo(qM)], [qV.eip.toLowerCase(), await fbo(qV)]]), usedFills: new Set([qKey]),
  bound: new Map([[qV.eip.toLowerCase(), await pub.readContract({ address: settlement, abi, functionName: "boundFilledBase", args: [qV.eip] }) as bigint]]) });
const qVview = noRcpt.orders.find((o: any) => o.orderEip712.toLowerCase() === qV.eip.toLowerCase())!;
check(qVview.filled === E("0.499") && qVview.boundFilled === E("0.499"), "even with no receipt published, the interface takes the true 0.499 from the contract");
const lateSell = await order(mallory2, "sell", "3000", "0.001");
check(await attempt(calldata(lateSell, qV, { price: lateSell.price, base: E("0.001") })) === "CounterpartyNotAllowed", "the attacker can't fill the 0.001 gap during the window");
check(await attempt(calldata(qM, qV, { price: qM.price, base: E("0.5") })) === "OrderAmountExceeded", "once an order is used up, a fill against it still reverts (nothing settles for zero)");

console.log("\n[R3-M] Republished copies of an order don't double its liquidity");
const rS = await order(mk2, "sell", "3000", "0.6");
const rCopy = fin({ ...JSON.parse(JSON.stringify(rS.oo)), objectHash: undefined, createdAt: rS.oo.createdAt + 1 });
check(rCopy.objectHash !== rS.oo.objectHash, "a copy with another createdAt is a different AON object");
const rSt = await A.deriveState([rS.ao, rS.oo, rCopy]);
check(rSt.orders.filter((o: any) => o.orderEip712.toLowerCase() === rS.eip.toLowerCase()).length === 1, "the book lists the signed order once, not twice");
const rB1 = await order(bob, "buy", "3000", "0.6"), rB2 = await order(alice, "buy", "3000", "0.6");
const rf = (mkOo: any, b: any) => A.fillObject(fin, { makerAuthHash: rS.ao.objectHash, takerAuthHash: b.ao.objectHash, makerOrderHash: mkOo.objectHash, takerOrderHash: b.oo.objectHash, price: rS.price, baseAmount: E("0.6"), executorFee: 0n });
const RF1 = rf(rS.oo, rB1), RF2 = rf(rCopy, rB2);
const rSt2 = await A.deriveState([rS.ao, rS.oo, rCopy, rB1.ao, rB1.oo, rB2.ao, rB2.oo, RF1, RF2]);
check(rSt2.orders.find((o: any) => o.orderEip712.toLowerCase() === rS.eip.toLowerCase())?.remaining !== undefined
  && rSt2.orders.filter((o: any) => o.orderEip712.toLowerCase() === rS.eip.toLowerCase()).every((o: any) => o.remaining <= 0n), "a fill against either copy counts against the same 0.6 in the interface");
const rstore: any[] = [rS.ao, rS.oo, rCopy, rB1.ao, rB1.oo, rB2.ao, rB2.oo, RF1, RF2];
const rvalid = async () => { const v: any[] = []; for (const o of rstore) { try { await ns.validateObject!(o); v.push(o); } catch {} } return v; };
const rg1 = ns.evaluate(await rvalid()).find((g: any) => g.status === "executable" && g.fill.objectHash === RF1.objectHash);
const rr1: any = await ns.execute!(rg1, { mode: "contract" }); rstore.push(rr1.receiptObject);
check(!ns.evaluate(await rvalid()).some((g: any) => g.status === "executable" && g.fill.objectHash === RF2.objectHash), "the executor doesn't try to fill the copy again after the original is used up");

console.log("\n[R3-L] Duplicate counterparties in a counter set");
const dupM = await order(mk1, "sell", "3000", "0.2");
const dupV = await order(bob, "buy", "3000", "0.4", { legs: [{ orderHash: dupM.eip, maxBase: E("0.2") }, { orderHash: dupM.eip, maxBase: E("0.2") }], exclBase: E("0.4") });
let dupErr = ""; try { await ns.validateObject!(dupV.oo); } catch (e: any) { dupErr = e.message; }
check(dupErr === "ORDER_COUNTER_SET_DUPLICATE", "the namespace rejects an order naming the same counterparty twice");
check(!(await A.deriveState([dupV.ao, dupV.oo])).orders.some((o: any) => o.orderObj.objectHash === dupV.oo.objectHash), "and the interface doesn't list it");

console.log("\n[R2-M] A cloned fill + copied receipt doesn't make the executor double-count");
const cMaker = await order(mk1, "sell", "3000", "1");
const cB1 = await order(bob, "buy", "3000", "0.5"), cB2 = await order(alice, "buy", "3000", "0.5");
const mkFill = (b: any) => A.fillObject(fin, { makerAuthHash: cMaker.ao.objectHash, takerAuthHash: b.ao.objectHash, makerOrderHash: cMaker.oo.objectHash, takerOrderHash: b.oo.objectHash, price: cMaker.price, baseAmount: E("0.5"), executorFee: 0n });
const F1 = mkFill(cB1), F2 = mkFill(cB2);
const cstore: any[] = [cMaker.ao, cMaker.oo, cB1.ao, cB1.oo, cB2.ao, cB2.oo, F1];
const cvalid = async () => { const v: any[] = []; for (const o of cstore) { try { await ns.validateObject!(o); v.push(o); } catch {} } return v; };
const g1 = ns.evaluate(await cvalid()).find((g: any) => g.status === "executable" && g.fill.objectHash === F1.objectHash);
const r1: any = await ns.execute!(g1, { mode: "contract" }); cstore.push(r1.receiptObject);
const F1clone = fin({ ...JSON.parse(JSON.stringify(F1)), objectHash: undefined, createdAt: F1.createdAt + 1 });
const R1clone = fin({ ...JSON.parse(JSON.stringify(r1.receiptObject)), objectHash: undefined, references: [F1clone.objectHash, ...r1.receiptObject.references.slice(1)] });
cstore.push(F1clone, R1clone, F2);
const ev = ns.evaluate(await cvalid());
check(ev.some((g: any) => g.status === "executable" && g.fill.objectHash === F2.objectHash), "the second legitimate fill is still executable (the copy didn't count twice)");
check(!ev.some((g: any) => g.status === "executable" && g.fill.objectHash === F1clone.objectHash), "and the clone isn't executed either");
const g2 = ev.find((g: any) => g.status === "executable" && g.fill.objectHash === F2.objectHash);
let ok2 = true; try { await ns.execute!(g2, { mode: "contract" }); } catch { ok2 = false; }
check(ok2, "the second fill settles");

console.log("\n[R2-M] If a matched counterparty cancels, the rest of the order still works");
const xM = await order(mk1, "sell", "3000", "0.3");
const xV = await order(bob, "buy", "3100", "1", { legs: [{ orderHash: xM.eip, maxBase: E("0.3") }], exclBase: E("0.3") });
const xa = authS(xM.ao);
await pub.waitForTransactionReceipt({ hash: await wc(mk1).writeContract({ address: settlement, abi, functionName: "revokeAuthorization", args: [xa] } as any) });
const other = await order(mallory, "sell", "3100", "1");
check(await attempt(calldata(other, xV, { price: other.price, base: E("0.7") })) === "CounterpartyNotAllowed", "during the window nobody else can trade with it");

console.log("\n[R2-L] Fee caps");
// one authorization backing two orders (allowed by the protocol)
const sharedAuth = A.buildAuthMessage({ market: m, grantor: bob.address, side: cfg.SIDE_BUY_BASE, baseAmount: E("2"), limitPrice: A.toPrice(m, "3000"), maxFee: U("10"), ttlSecs: 86400 });
const sAo = A.authObject(fin, sharedAuth, await bob.signTypedData({ domain: cfg.getEvmSpotDomain(), types: cfg.AUTH_TYPES, primaryType: "TradingSessionAuthorization", message: A.authForSigning(sharedAuth) }));
const tinyMsg = A.buildOrderMessage({ market: m, trader: bob.address, side: cfg.SIDE_BUY_BASE, price: A.toPrice(m, "3000"), baseAmount: E("0.001"), auth: sharedAuth });
const tinyOo = A.orderObject(fin, sAo.objectHash, tinyMsg, await bob.signTypedData({ domain: cfg.getEvmSpotDomain(), types: cfg.ORDER_TYPES, primaryType: "SignedOrder", message: A.orderForSigning(tinyMsg) }));
const tiny = { ao: sAo, oo: tinyOo, price: A.toPrice(m, "3000"), base: E("0.001"), eip: A.orderEip712(tinyMsg) };
const tS = await order(alice, "sell", "3000", "0.001");
check(await attempt(calldata(tS, tiny, { price: tS.price, base: E("0.001"), fee: U("10") })) === "ExecutorFeeTooHigh", "a tiny order sharing an authorization can't take the whole 10 USDT fee budget");
const uS = await order(alice, "sell", "3000", "0.1");
const uAuth = A.buildAuthMessage({ market: m, grantor: bob.address, side: cfg.SIDE_BUY_BASE, baseAmount: E("0.1"), limitPrice: A.toPrice(m, "3000"), maxFee: maxUint256, ttlSecs: 86400 });
const uAo = A.authObject(fin, uAuth, await bob.signTypedData({ domain: cfg.getEvmSpotDomain(), types: cfg.AUTH_TYPES, primaryType: "TradingSessionAuthorization", message: A.authForSigning(uAuth) }));
const uMsg = A.buildOrderMessage({ market: m, trader: bob.address, side: cfg.SIDE_BUY_BASE, price: A.toPrice(m, "3000"), baseAmount: E("0.1"), auth: uAuth });
const uOo = A.orderObject(fin, uAo.objectHash, uMsg, await bob.signTypedData({ domain: cfg.getEvmSpotDomain(), types: cfg.ORDER_TYPES, primaryType: "SignedOrder", message: A.orderForSigning(uMsg) }));
check(await attempt(calldata(uS, { ao: uAo, oo: uOo, eip: A.orderEip712(uMsg) }, { price: uS.price, base: E("0.1") })) === "OK", "a buyer who signs an unlimited fee cap can still trade (no overflow)");

console.log("\n[R2-L] An executor can't force the WETH fallback with a tight gas limit");
let sawWeth = false, delivered = false, reverts = 0;
for (let g = 150_000n; g <= 420_000n && !delivered; g += 6_000n) {
  const gS = await order(alice, "sell", "3000", "0.05"), gB = await order(mallory, "buy", "3000", "0.05", { receiveNative: true });
  const e0 = await pub.getBalance({ address: mallory.address }), w0 = await bal(weth, "MockWETH", mallory.address);
  try {
    const h = await wc(executor).sendTransaction({ to: settlement, data: calldata(gS, gB, { price: gS.price, base: gS.base }) as any, gas: g });
    const rc = await pub.waitForTransactionReceipt({ hash: h });
    if (rc.status !== "success") { reverts++; continue; }
    if ((await bal(weth, "MockWETH", mallory.address)) > w0) sawWeth = true;
    if ((await pub.getBalance({ address: mallory.address })) - e0 === E("0.05")) delivered = true;
  } catch { reverts++; }
}
check(!sawWeth && delivered, `across gas limits from 150k up, a normal wallet either gets real ETH or the tx reverts (${reverts} too-low limits reverted), never forced to WETH`);

console.log("\n[M] Front-running protection never opens up at the limit");
const pM = await order(mk1, "sell", "3000", "0.3");
const pV = await order(bob, "buy", "3100", "0.3", { legs: [{ orderHash: pM.eip, maxBase: E("0.3") }], exclBase: E("0.3") });
const runner = await order(mallory, "buy", "3000", "0.3");
check(await attempt(calldata(pM, runner, { price: pM.price, base: E("0.3") })) === "OK", "a front-runner takes the victim's matched ask first");
const runnerSell = await order(mallory, "sell", "3100", "0.3");
check(await attempt(calldata(runnerSell, pV, { price: runnerSell.price, base: E("0.3") })) === "CounterpartyNotAllowed", "during the window they can't sell into the victim at 3100");
await pub.request({ method: "evm_increaseTime" as any, params: [301] as any }); await pub.request({ method: "evm_mine" as any, params: [] as any });
check(await attempt(calldata(other, xV, { price: other.price, base: E("0.7") })) === "OK", "after the window, the unreserved 0.7 of the cancelled-counterparty order fills normally");
const other2 = await order(mallory2, "sell", "3100", "0.3");
check(await attempt(calldata(other2, xV, { price: other2.price, base: E("0.3") })) === "ReservedPartVoid", "…but its void reserved 0.3 never opens up at 3100");
check(await attempt(calldata(runnerSell, pV, { price: runnerSell.price, base: E("0.3") })) === "ReservedPartVoid", "after the window either: the reserved part is void instead of opening at 3100");

console.log(`\nAll ${pass} checks passed.`);
