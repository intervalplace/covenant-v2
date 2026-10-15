/**
 * Checks a deployed AonEvmSpotSettlement against this repo's source.
 *
 *   ETH_RPC_URL=https://... NAMESPACE_DIR=../aon-namespace-evm-spot \
 *   npm run check-deploy -- 0xYourContract
 *
 * Compiles the contract locally with the production settings, then compares
 * the on-chain runtime code byte for byte (immutables filled in from chain,
 * the trailing compiler-metadata blob ignored since it depends on file paths).
 * Also checks WETH, the chain id in the domain separator, and that nothing
 * else (owner, admin) exists. Paste the output back.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, getAddress, keccak256, encodeAbiParameters, toBytes } from "viem";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const addr = process.argv[2];
const RPC = process.env.ETH_RPC_URL;
const NSDIR = resolve(process.env.NAMESPACE_DIR ?? join(ROOT, "../aon-namespace-evm-spot"));
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };
if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) fail("Usage: npm run check-deploy -- 0xContractAddress");
if (!RPC) fail("Set ETH_RPC_URL.");

const source = readFileSync(join(NSDIR, "src/contracts/GenericEvmSpotSettlement.sol"), "utf8");
const solc = require("solc");
if (!String(solc.version()).startsWith("0.8.26")) fail(`solc ${solc.version()}; expected 0.8.26 (npm ci)`);
const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity",
  sources: { "GenericEvmSpotSettlement.sol": { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi", "evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences"] } } } })));
for (const e of out.errors ?? []) if (e.severity === "error") fail(e.formattedMessage);
const c = out.contracts["GenericEvmSpotSettlement.sol"].AonEvmSpotSettlement;

const pub = createPublicClient({ transport: http(RPC) });
const chainId = await pub.getChainId();
const onchain = (await pub.getCode({ address: addr }))?.slice(2) ?? "";
if (!onchain) fail(`No code at ${addr} on chain ${chainId}.`);

// Strip the CBOR metadata tail (its length is in the last 2 bytes)
const strip = (hex) => hex.slice(0, hex.length - (parseInt(hex.slice(-4), 16) + 2) * 2);
let local = c.evm.deployedBytecode.object;
for (const refs of Object.values(c.evm.deployedBytecode.immutableReferences ?? {}))
  for (const { start, length } of refs)
    local = local.slice(0, start * 2) + onchain.slice(start * 2, (start + length) * 2) + local.slice((start + length) * 2);
let pass = 0;
const ok = (cond, msg) => { if (!cond) fail(msg); pass++; console.log(`✓ ${msg}`); };

console.log(`Contract ${getAddress(addr)} on chain ${chainId}\n`);
ok(strip(local) === strip(onchain), `runtime code matches the reviewed source (${strip(onchain).length / 2} bytes, solc 0.8.26, optimizer 200, viaIR, cancun)`);
const read = (fn) => pub.readContract({ address: addr, abi: c.abi, functionName: fn });
const weth = await read("WRAPPED_NATIVE");
ok(chainId !== 1 || getAddress(weth) === WETH, `WRAPPED_NATIVE is ${weth}${chainId === 1 ? " (mainnet WETH)" : ""}`);
const ds = await read("domainSeparator");
const expected = keccak256(encodeAbiParameters(
  [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
  [keccak256(toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
   keccak256(toBytes("AON EVM Spot")), keccak256(toBytes("1")), BigInt(chainId), getAddress(addr)]));
ok(ds === expected, `EIP-712 domain is bound to chain ${chainId} and this address`);
const writes = c.abi.filter((x) => x.type === "function" && !["view", "pure"].includes(x.stateMutability)).map((x) => x.name).sort();
ok(JSON.stringify(writes) === JSON.stringify(["cancelOrder", "revokeAuthorization", "settleSpotTrade"]),
  `only state-changing functions: ${writes.join(", ")} (no owner, no admin, no upgrade)`);

console.log(`\nAll ${pass} checks passed. Set NEXT_PUBLIC_EVM_SPOT_SETTLEMENT=${getAddress(addr)}`);
