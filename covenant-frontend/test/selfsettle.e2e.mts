import { createPublicClient, createWalletClient, http, custom, fallback, defineChain, parseUnits, maxUint256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { finalizeObject } from "@intervalplace/aon-sdk";

const art = JSON.parse(readFileSync("/home/claude/e2e/artifacts.json", "utf8"));
const chain = defineChain({ id: 31337, name: "anvil", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } });
const pub = createPublicClient({ chain, transport: http() });
const K = ["0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80","0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d","0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"] as const;
const [executor, alice, bob] = K.map(k => privateKeyToAccount(k));
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
const { evmSpotSettlementAbi: feAbi } = await import("./fe/abi.ts");
const { walletReader } = await import("./fe/endpoints.ts");
const { evmSpotNamespace: ns } = await import("./ns/namespace.ts");
const m = cfg.MARKETS[0];
const store: any[] = []; const fin = (o: any) => finalizeObject(o) as any; const put = (o: any) => store.push(o);
const lookup = (h: string) => store.find(o => o.objectHash.toLowerCase() === String(h).toLowerCase());

console.log("\n[1] The interface's ABI matches the compiled contract");
// Canonical form: drop internalType, sort keys (key order isn't meaningful)
const strip = (x: any): any => Array.isArray(x) ? x.map(strip) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== "internalType").sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, strip(v)])) : x;
const compiledSettle = strip(art.AonEvmSpotSettlement.abi.find((x: any) => x.name === "settleSpotTrade"));
const feSettle = strip(feAbi.find((x: any) => x.name === "settleSpotTrade"));
check(JSON.stringify(compiledSettle.inputs) === JSON.stringify(feSettle.inputs), "settleSpotTrade signature is identical");
const sigOf = (e: any) => `${e.name}(${e.inputs.map((i: any) => i.type).join(",")})`;
const compiledErrs = new Set(art.AonEvmSpotSettlement.abi.filter((x: any) => x.type === "error").map(sigOf));
check(feAbi.filter((x: any) => x.type === "error").every((e: any) => compiledErrs.has(sigOf(e))), "every error the interface decodes exists in the contract");

for (const a of [alice, bob]) {
  await send(a, weth, "MockWETH", "deposit", [], E("5"));
  await send(executor, usdt, "MockUSDT", "mint", [a.address, U("50000")]);
  await send(a, weth, "MockWETH", "approve", [settlement, maxUint256]);
  await send(a, usdt, "MockUSDT", "approve", [settlement, maxUint256]);
}
async function trade(seller: any, buyer: any, amount: string, px: string, receiveNative = false) {
  const mk = async (acct: any, side: number, counterSet: any[] = [], excl = 0n) => {
    const price = A.toPrice(m, px), base = A.toBaseUnits(m, amount);
    const auth = A.buildAuthMessage({ market: m, grantor: acct.address, side, baseAmount: base, limitPrice: price, maxFee: side === cfg.SIDE_BUY_BASE ? cfg.EXECUTOR_FEE_QUOTE * 20n : 0n, ttlSecs: 3600 });
    const ao = A.authObject(fin, auth, await acct.signTypedData({ domain: cfg.getEvmSpotDomain(), types: cfg.AUTH_TYPES, primaryType: "TradingSessionAuthorization", message: A.authForSigning(auth) }));
    const o = A.buildOrderMessage({ market: m, trader: acct.address, side, price, baseAmount: base, auth, receiveNative: side === cfg.SIDE_BUY_BASE && receiveNative, counterSet, exclusiveBase: excl, exclusiveUntil: Math.floor(Date.now() / 1000) + 120 });
    const oo = A.orderObject(fin, ao.objectHash, o, await acct.signTypedData({ domain: cfg.getEvmSpotDomain(), types: cfg.ORDER_TYPES, primaryType: "SignedOrder", message: A.orderForSigning(o) }), counterSet);
    put(ao); put(oo); return { ao, oo, price, base };
  };
  const s = await mk(seller, cfg.SIDE_SELL_BASE);
  const b = await mk(buyer, cfg.SIDE_BUY_BASE, [A.orderEip712(s.oo.payload.order)], A.toBaseUnits(m, amount)); // bound, like the UI does
  const f = A.fillObject(fin, { makerAuthHash: s.ao.objectHash, takerAuthHash: b.ao.objectHash, makerOrderHash: s.oo.objectHash, takerOrderHash: b.oo.objectHash, price: s.price, baseAmount: s.base, executorFee: cfg.EXECUTOR_FEE_QUOTE });
  put(f); return f;
}
async function selfSettle(acct: any, fillHash: string) {
  const call = A.buildSettleCall(lookup, fillHash)!;
  const hash = await wc(acct).writeContract({ address: settlement, abi: feAbi, functionName: "settleSpotTrade", args: call.args as any });
  const rc = await pub.waitForTransactionReceipt({ hash });
  return { call, rc, hash };
}
async function runExecutor() {
  const valid: any[] = [];
  for (const o of store) { try { await ns.validateObject!(o); valid.push(o); } catch {} }
  let n = 0;
  for (const g of ns.evaluate(valid).filter((g: any) => g.status === "executable")) { try { const r: any = await ns.execute!(g, { mode: "contract" }); put(r.receiptObject); n++; } catch {} }
  return n;
}

console.log("\n[2] A buyer settles their own trade");
const f1 = await trade(alice, bob, "0.4", "3000", true);
const bobEth0 = await pub.getBalance({ address: bob.address }), aliceU0 = await bal(usdt, "MockUSDT", alice.address), bobU0 = await bal(usdt, "MockUSDT", bob.address);
const s1 = await selfSettle(bob, f1.objectHash);
check(s1.rc.status === "success", "Bob's wallet submits the settlement and it succeeds (counter set included)");
const gasCost = s1.rc.gasUsed * s1.rc.effectiveGasPrice;
check((await pub.getBalance({ address: bob.address })) - bobEth0 + gasCost === E("0.4"), "Bob received 0.4 native ETH (minus only his own gas)");
check((await bal(usdt, "MockUSDT", alice.address)) - aliceU0 === U("1200"), "Alice received 1,200 USDT");
check(bobU0 - (await bal(usdt, "MockUSDT", bob.address)) === U("1200"), "Bob paid exactly 1,200 USDT: the executor fee went to himself, so net zero");
const rcpt = A.settleReceiptObject(fin, s1.call, s1.hash, A.settledAmounts(s1.rc.logs as any, s1.call.fillKey)!);
let rcErr = null; try { await ns.validateObject!(rcpt); } catch (e: any) { rcErr = e.message; }
check(rcErr === null, "the receipt it publishes passes the executor's own on-chain verification");
put(rcpt);
check(await runExecutor() === 0, "executors then see the trade as done and don't try again");
check((await A.deriveState(store)).fills.find(f => f.fillHash === f1.objectHash)!.status === "settled", "the interface shows it settled");

console.log("\n[3] Racing an executor");
const f2 = await trade(alice, bob, "0.1", "3010");
check(await runExecutor() === 1, "the executor settles it first");
let raced = "none";
try { await selfSettle(bob, f2.objectHash); } catch (e: any) { raced = /FillReplay/.test(String(e?.message) + String(e?.shortMessage)) ? "FillReplay" : String(e?.shortMessage ?? e).slice(0, 80); }
check(raced === "FillReplay", "Bob's late attempt is stopped before sending (FillReplay, no gas spent), which the UI reports as already settled");

console.log("\n[4] A seller can settle too");
const f3 = await trade(alice, bob, "0.2", "3020");
const aU = await bal(usdt, "MockUSDT", alice.address);
const s3 = await selfSettle(alice, f3.objectHash);
check(s3.rc.status === "success" && (await bal(usdt, "MockUSDT", alice.address)) - aU === U("604") + cfg.EXECUTOR_FEE_QUOTE, "Alice settles her sale and also earns the 0.10 executor fee Bob agreed to pay");

console.log("\n[5] Missing pieces");
check(A.buildSettleCall(() => undefined, f3.objectHash) === null, "without the signed objects, there's nothing to send (the UI asks to retry)");

console.log("\n[6] Reading through the wallet");
let walletCalls = 0;
const fakeWallet = (chainHex: string, accounts: string[]) => ({
  request: async ({ method, params }: any) => {
    if (method === "eth_chainId") return chainHex;
    if (method === "eth_accounts") return accounts;
    walletCalls++;
    return pub.request({ method, params } as any);
  },
  on: () => {},
});
const errOf = async (p: Promise<any>) => p.then(() => "OK", (e: any) => e.message);
check(await errOf(walletReader(fakeWallet("0x2105", [bob.address]), 31337).request({ method: "eth_blockNumber" })) === "WALLET_ON_OTHER_CHAIN", "a wallet on another chain (Base) is never read from");
check(await errOf(walletReader(fakeWallet("0x7a69", []), 31337).request({ method: "eth_blockNumber" })) === "WALLET_NOT_CONNECTED", "a wallet that isn't connected isn't used");
check(await errOf(walletReader(fakeWallet("0x7a69", [bob.address]), 31337).request({ method: "eth_sendTransaction", params: [] })) === "WALLET_READS_ONLY", "only read methods go through this path");
const viaWallet = createPublicClient({ chain, transport: fallback([custom(walletReader(fakeWallet("0x7a69", [bob.address]), 31337)), http("http://127.0.0.1:1")]) });
walletCalls = 0;
check((await viaWallet.getBlockNumber()) > 0n && walletCalls > 0, "connected on the right chain: reads go through the wallet");
const wrongChain = createPublicClient({ chain, transport: fallback([custom(walletReader(fakeWallet("0x2105", [bob.address]), 31337)), http("http://127.0.0.1:8545")]) });
walletCalls = 0;
check((await wrongChain.getBlockNumber()) > 0n && walletCalls === 0, "on the wrong chain: falls through to the next connection");
const reverts = await errOf(viaWallet.readContract({ address: settlement, abi: feAbi, functionName: "usedFillNonce" as any, args: ["0x" + "00".repeat(32)] } as any));
check(reverts === "OK", "contract reads work through the wallet path");

console.log(`\nAll ${pass} checks passed.`);
