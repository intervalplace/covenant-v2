// Builds deploy/deploy.html: a one-tap page that deploys AonEvmSpotSettlement
// from your own wallet (e.g. MetaMask's in-app browser on a phone).
//
//   cd covenant-frontend && npm ci && node ../deploy/build-deploy-page.mjs
//
// The init code is compiled from deploy/etherscan-standard-input.json with
// solc 0.8.26 — the same input Etherscan verification uses — so the deployed
// contract verifies with that file as-is.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../covenant-frontend/package.json"));
const solc = require("solc");
const { keccak256, toBytes } = require("viem");
if (!solc.version().startsWith("0.8.26")) throw new Error(`solc ${solc.version()}; expected 0.8.26`);

const KEY = "contracts/GenericEvmSpotSettlement.sol";
const input = JSON.parse(readFileSync(join(here, "etherscan-standard-input.json"), "utf8"));
const source = input.sources[KEY].content;
const onDisk = readFileSync(join(here, "../aon-namespace-evm-spot/src/contracts/GenericEvmSpotSettlement.sol"), "utf8");
if (source !== onDisk) throw new Error("etherscan-standard-input.json is out of date with the contract source");

input.settings.outputSelection = { "*": { "*": ["evm.bytecode.object"] } };
const out = JSON.parse(solc.compile(JSON.stringify(input)));
for (const e of out.errors ?? []) if (e.severity === "error") throw new Error(e.formattedMessage);
const initcode = "0x" + out.contracts[KEY].AonEvmSpotSettlement.evm.bytecode.object;

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const sel = (sig) => keccak256(toBytes(sig)).slice(0, 10);
const values = {
  INITCODE: initcode,
  INITCODE_SHA256: sha256(Buffer.from(initcode.slice(2), "hex")),
  SOURCE_SHA256: sha256(source),
  SEL_WRAPPED_NATIVE: sel("WRAPPED_NATIVE()"),
  SEL_DOMAIN_SEPARATOR: sel("domainSeparator()"),
};
let html = readFileSync(join(here, "deploy.template.html"), "utf8");
for (const [k, v] of Object.entries(values)) html = html.replaceAll(`__${k}__`, v);
if (/__[A-Z_]+__/.test(html)) throw new Error("unfilled placeholder in template");
writeFileSync(join(here, "deploy.html"), html);
console.log(`deploy/deploy.html written. Init code ${(initcode.length - 2) / 2} bytes, sha256 ${values.INITCODE_SHA256}`);
