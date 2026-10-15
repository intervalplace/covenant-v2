import { createPublicClient, createWalletClient, http, defineChain, parseUnits, maxUint256, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { finalizeObject } from "@intervalplace/aon-sdk";

const art = JSON.parse(readFileSync("/home/claude/e2e/artifacts.json", "utf8"));
const chain = defineChain({ id: 31337, name: "anvil", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } });
const pub = createPublicClient({ chain, transport: http() });
const K = ["0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80","0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d","0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a","0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6","0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a","0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba","0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e"] as const;
const [executor, alice, bob, carol, mallory, dave, erin] = K.map(k => privateKeyToAccount(k));
const wc = (a: any) => createWalletClient({ account: a, chain, transport: http() });
const deploy = async (n: string, args: any[] = []) => (await pub.waitForTransactionReceipt({ hash: await wc(executor).deployContract({ abi: art[n].abi, bytecode: art[n].bytecode, args }) })).contractAddress!;
const send = async (acct: any, address: any, n: string, fn: string, args: any[], value?: bigint) => pub.waitForTransactionReceipt({ hash: await wc(acct).writeContract({ address, abi: art[n].abi, functionName: fn, args, value } as any) });
const bal = (t: any, n: string, who: any) => pub.readContract({ address: t, abi: art[n].abi, functionName: "balanceOf", args: [who] }) as Promise<bigint>;
let pass = 0;
const check = (c: any, l: string) => { if (!c) { console.error("  FAIL:", l); process.exit(1); } pass++; console.log("  ok -", l); };
const E = (x: string) => parseUnits(x, 18), U = (x: string) => parseUnits(x, 6);

const weth = await deploy("MockWETH"), usdt = await deploy("MockUSDT"), settlement = await deploy("AonEvmSpotSettlement", [weth]);
Object.assign(process.env, { NEXT_PUBLIC_CHAIN_ID: "31337", NEXT_PUBLIC_EVM_SPOT_SETTLEMENT: settlement, NEXT_PUBLIC_WETH_ADDRESS: weth, NEXT_PUBLIC_USDT_ADDRESS: usdt, NEXT_PUBLIC_EXECUTOR_FEE_QUOTE: "100000", AON_EVM_RPC_URL: "http://127.0.0.1:8545", AON_EXECUTOR_PRIVATE_KEY: K[0], AON_EVM_SPOT_SETTLEMENT_CONTRACT: settlement });
const cfg = await import("./fe/config.ts"); const A = await import("./fe/aon.ts");
const { evmSpotNamespace: ns } = await import("./ns/namespace.ts");
check(cfg.MARKETS.length === 1 && cfg.MARKETS[0].key === "ETH-USDT", "only ETH/USDT is listed by default");
const m = cfg.MARKETS[0];
for (const a of [alice, bob, carol, mallory, dave, erin]) {
  await send(a, weth, "MockWETH", "deposit", [], E("20"));
  await send(executor, usdt, "MockUSDT", "mint", [a.address, U("100000")]);
  await send(a, weth, "MockWETH", "approve", [settlement, maxUint256]);
  await send(a, usdt, "MockUSDT", "approve", [settlement, maxUint256]);
}
const store: any[] = []; const fin = (o: any) => finalizeObject(o) as any;
const put = (o: any) => { if ((finalizeObject({ ...o, objectHash: undefined }) as any).objectHash !== o.objectHash) throw new Error("HASH"); store.push(o); };

// Mirrors page.tsx submitOrder()
async function submit(acct: any, side: "buy" | "sell", type: "limit" | "market", amount: string, limitHuman?: string, opts: { receiveNative?: boolean; noFills?: boolean } = {}) {
  const st = await A.deriveState(store);
  const limit = type === "limit" ? A.toPrice(m, limitHuman!) : null;
  const mt = A.matchOrder({ book: st.orders, market: m, side, amount: A.toBaseUnits(m, amount), limit, me: acct.address });
  if (mt.selfCross) throw new Error("self-cross");
  const price = limit ?? mt.worstPrice!, base = type === "limit" ? A.toBaseUnits(m, amount) : mt.filled;
  const sideNum = side === "buy" ? cfg.SIDE_BUY_BASE : cfg.SIDE_SELL_BASE;
  const maxFee = side === "buy" ? cfg.EXECUTOR_FEE_QUOTE * cfg.MAX_FILLS_PER_ORDER : 0n;
  const auth = A.buildAuthMessage({ market: m, grantor: acct.address, side: sideNum, baseAmount: base, limitPrice: price, maxFee, ttlSecs: type === "limit" ? cfg.MAKER_ORDER_TTL_SECS : cfg.MARKET_ORDER_TTL_SECS });
  const authObj = A.authObject(fin, auth, await acct.signTypedData({ domain: cfg.getEvmSpotDomain(), types: cfg.AUTH_TYPES, primaryType: "TradingSessionAuthorization", message: A.authForSigning(auth) }));
  const counterSet = mt.legs.map(l => l.order.orderEip712);
  const order = A.buildOrderMessage({ market: m, trader: acct.address, side: sideNum, price, baseAmount: base, auth, receiveNative: opts.receiveNative,
    counterSet, exclusiveBase: mt.filled, exclusiveUntil: type === "limit" ? Math.floor(Date.now() / 1000) + cfg.EXCLUSIVE_WINDOW_SECS : Number(auth.validBefore) });
  const orderObj = A.orderObject(fin, authObj.objectHash, order, await acct.signTypedData({ domain: cfg.getEvmSpotDomain(), types: cfg.ORDER_TYPES, primaryType: "SignedOrder", message: A.orderForSigning(order) }), counterSet);
  put(authObj); put(orderObj);
  const fills: any[] = [];
  if (!opts.noFills) for (const leg of mt.legs) {
    const f = A.fillObject(fin, { makerAuthHash: leg.order.authObj.objectHash, takerAuthHash: authObj.objectHash, makerOrderHash: leg.order.orderObj.objectHash, takerOrderHash: orderObj.objectHash, price: leg.price, baseAmount: leg.base, executorFee: cfg.EXECUTOR_FEE_QUOTE });
    put(f); fills.push(f);
  }
  return { mt, authObj, orderObj, fills };
}
async function runExecutor() {
  const valid: any[] = [];
  for (const o of store) { try { await ns.validateObject!(o); valid.push(o); } catch {} }
  const gs = ns.evaluate(valid).filter((g: any) => g.status === "executable");
  let ok = 0;
  for (const g of gs) { try { const r: any = await ns.execute!(g, { mode: "contract" }); put(r.receiptObject); ok++; } catch {} }
  return ok;
}
const rejected = async (o: any) => { try { await ns.validateObject!(o); return null; } catch (e: any) { return e.message; } };

// Build settle calldata straight from AON objects — what an attacker would
// send to the contract directly, bypassing every executor and interface.
const H = (h: string) => store.find(o => o.objectHash === h);
const authS = (o: any) => { const a = o.payload.authorization; return { ...a, sideMask: Number(a.sideMask), maxBaseExposure: BigInt(a.maxBaseExposure), maxQuoteExposure: BigInt(a.maxQuoteExposure), maxExecutorFeeQuote: BigInt(a.maxExecutorFeeQuote), minPrice: BigInt(a.minPrice), maxPrice: BigInt(a.maxPrice), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) }; };
const ordS = (o: any) => { const x = o.payload.order; return { ...x, side: Number(x.side), price: BigInt(x.price), baseAmount: BigInt(x.baseAmount), validAfter: BigInt(x.validAfter), validBefore: BigInt(x.validBefore), exclusiveBase: BigInt(x.exclusiveBase), exclusiveUntil: BigInt(x.exclusiveUntil) }; };
function directCall(mkOrder: any, tkOrder: any, price: bigint, base: bigint, sets?: { maker?: string[]; taker?: string[] }) {
  const mA = H(mkOrder.references[0]), tA = H(tkOrder.references[0]);
  return encodeFunctionData({ abi: art.AonEvmSpotSettlement.abi, functionName: "settleSpotTrade", args: [
    authS(mA), mA.signature.signature, ordS(mkOrder), mkOrder.signature.signature,
    authS(tA), tA.signature.signature, ordS(tkOrder), tkOrder.signature.signature,
    { makerOrderHash: A.orderEip712(mkOrder.payload.order), takerOrderHash: A.orderEip712(tkOrder.payload.order),
      makerAuthHash: mkOrder.payload.order.sessionAuthHash, takerAuthHash: tkOrder.payload.order.sessionAuthHash,
      price, baseAmount: base, quoteAmount: A.quoteFor(base, price), executorFeeQuoteAmount: 0n, fillNonce: A.randomHex32(),
      makerCounterSet: sets?.maker ?? mkOrder.payload.counterSet ?? [], takerCounterSet: sets?.taker ?? tkOrder.payload.counterSet ?? [] } ] });
}
const revertName = async (data: string) => { try { await pub.call({ to: settlement, data: data as any, account: mallory.address }); return "OK"; } catch (e: any) { const raw = e?.cause?.data ?? e?.data ?? e?.cause?.cause?.data; const hex = typeof raw === "string" ? raw : raw?.data; if (process.env.DBG) console.log("    [dbg]", (e?.shortMessage ?? "").slice(0,120), hex); try { return (await import("viem")).decodeErrorResult({ abi: art.AonEvmSpotSettlement.abi, data: hex }).errorName; } catch { return "UNDECODED:" + String(e?.shortMessage ?? e).slice(0, 100); } } };

console.log("\n[1] The attack this fixes");
await submit(alice, "sell", "limit", "0.5", "3005");
await submit(alice, "sell", "limit", "0.5", "3010");
const bob1 = await submit(bob, "buy", "limit", "1.2", "3015");
const bo = bob1.orderObj.payload.order;
check(bob1.mt.legs.length === 2 && bob1.orderObj.payload.counterSet.length === 2, "Bob's buy names the two asks it matched");
check(BigInt(bo.exclusiveBase) === E("1") && bo.counterSetHash !== A.ZERO32, "the 1.0 ETH that fills now is reserved for them");
// Mallory sees Bob's order on AON and races in with her own ask at Bob's limit
const mal = await submit(mallory, "sell", "limit", "1", "3015", { noFills: true });
check(await revertName(directCall(mal.orderObj, bob1.orderObj, A.toPrice(m, "3015"), E("1"))) === "CounterpartyNotAllowed",
  "Mallory pairing her 3015 ask with Bob's order is rejected by the contract");
const aliceAsk = H(bob1.fills[0].payload.fill.makerOrderHash);
check(await revertName(directCall(aliceAsk, bob1.orderObj, A.toPrice(m, "3015"), E("0.5"))) === "InvalidPrice",
  "pairing Bob with the right ask but at his 3015 limit instead of its 3005 is rejected");
check(await revertName(directCall(aliceAsk, bob1.orderObj, A.toPrice(m, "3005"), E("0.5"), { taker: [] })) === "CounterSetMismatch",
  "dropping Bob's counter set from the fill is rejected");
check(await revertName(directCall(aliceAsk, bob1.orderObj, A.toPrice(m, "3005"), E("0.5"))) === "OK",
  "the honest fill (named ask, its price) is accepted");

console.log("\n[2] The honest path still works");
const bobW0 = await bal(weth, "MockWETH", bob.address), bobU0 = await bal(usdt, "MockUSDT", bob.address);
check(await runExecutor() === 2, "executor settles Bob's two intended fills");
check((await bal(weth, "MockWETH", bob.address)) - bobW0 === E("1"), "Bob received 1.0 ETH");
check(bobU0 - (await bal(usdt, "MockUSDT", bob.address)) === U("3007.5") + U("0.2"), "Bob paid 3007.5 USDT (the book price) plus two 0.10 fees, not 3015");
const st2 = await A.deriveState(store);
const bobRow = st2.orders.find(o => o.orderObj.objectHash === bob1.orderObj.objectHash)!;
check(bobRow.remaining === E("0.2") && !A.isReserved(bobRow), "Bob's 0.2 remainder now rests at 3015, open to anyone");
check(await revertName(directCall(mal.orderObj, bob1.orderObj, A.toPrice(m, "3015"), E("0.2"))) === "OK",
  "once the reserved part has filled, the remainder can be taken at Bob's own limit, as intended");

console.log("\n[3] Market orders stay bound for their whole life");
await submit(carol, "buy", "limit", "0.3", "2990");
const dave1 = await submit(dave, "sell", "market", "0.3", undefined, { noFills: true });
check(BigInt(dave1.orderObj.payload.order.exclusiveBase) === E("0.3") && Number(dave1.orderObj.payload.order.exclusiveUntil) === Number(H(dave1.orderObj.references[0]).payload.authorization.validBefore),
  "a market sell is reserved for its matched bid until it expires");
const malBid = await submit(mallory, "buy", "limit", "0.3", "2990", { noFills: true });
check(await revertName(directCall(malBid.orderObj, dave1.orderObj, A.toPrice(m, "2990"), E("0.3"))) === "CounterpartyNotAllowed",
  "nobody else can fill Dave's market sell, even at the same price");

console.log("\n[4] A reserved order doesn't get stuck");
await submit(erin, "sell", "limit", "0.4", "3100");
const carol2 = await submit(carol, "buy", "limit", "0.4", "3100", { noFills: true }); // its fill is never published
const resv = (await A.deriveState(store)).orders.find(o => o.orderObj.objectHash === carol2.orderObj.objectHash)!;
check(A.isReserved(resv), "while reserved, the UI keeps it out of the book and the matcher");
const malAsk2 = await submit(mallory, "sell", "limit", "0.4", "3100", { noFills: true });
check(await revertName(directCall(malAsk2.orderObj, carol2.orderObj, A.toPrice(m, "3100"), E("0.4"))) === "CounterpartyNotAllowed", "reserved for Erin's ask during the window");
await pub.request({ method: "evm_increaseTime" as any, params: [cfg.EXCLUSIVE_WINDOW_SECS + 1] as any });
await pub.request({ method: "evm_mine" as any, params: [] as any });
check(await revertName(directCall(malAsk2.orderObj, carol2.orderObj, A.toPrice(m, "3100"), E("0.4"))) === "OK", "after the 2-minute window it's an ordinary resting order again");
check(!A.isReserved(resv, Math.floor(Date.now() / 1000) + cfg.EXCLUSIVE_WINDOW_SECS + 1), "…and the UI agrees once the window has passed");

console.log("\n[5] Tampering");
const t = JSON.parse(JSON.stringify(bob1.orderObj)); t.payload.counterSet = [A.randomHex32(), A.randomHex32()];
const tampered = fin({ ...t, objectHash: undefined });
check((await rejected(tampered)) === "ORDER_COUNTER_SET_HASH_MISMATCH", "executor rejects an order whose published counter set was swapped");
check(!(await A.deriveState([...store.filter(o => o !== bob1.orderObj), tampered])).orders.some(o => o.orderObj.objectHash === tampered.objectHash), "…and so does the UI");
const t2 = JSON.parse(JSON.stringify(bob1.orderObj)); delete t2.payload.counterSet;
check((await rejected(fin({ ...t2, objectHash: undefined }))) === "ORDER_COUNTER_SET_INVALID", "an order with its counter set stripped is rejected");

console.log("\n[6] Everything else still works");
const plain = await submit(alice, "sell", "limit", "0.25", "3300");
check(plain.orderObj.payload.order.counterSetHash === A.ZERO32 && !("counterSet" in plain.orderObj.payload), "an order that matches nothing is unbound");
const daveEth0 = await pub.getBalance({ address: dave.address });
const dn = await submit(dave, "buy", "limit", "0.25", "3300", { receiveNative: true });
check(dn.mt.legs.length === 1, "Dave's buy matches the plain ask");
check(await runExecutor() >= 1, "executor settles it");
check((await pub.getBalance({ address: dave.address })) - daveEth0 === E("0.25"), "native ETH payout still works with binding in place");
const q = A.quoteFor(E("0.008"), A.toPrice(m, "3000"));
check(q < cfg.MIN_ORDER_QUOTE && A.quoteFor(E("0.01"), A.toPrice(m, "3000")) >= cfg.MIN_ORDER_QUOTE, "minimum order: 0.008 ETH (24 USDT) is too small, 0.01 ETH (30 USDT) is fine");

const gasRcpt = await pub.getTransactionReceipt({ hash: store.filter(o => o.objectType === "receipt").at(-1).payload.executionTx });
console.log(`\nAll ${pass} checks passed. Native-ETH settlement used ${gasRcpt.gasUsed} gas.`);
