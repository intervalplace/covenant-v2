// Verify the deployed settlement contract on Etherscan with the exact
// compiler input in deploy/etherscan-standard-input.json.
//
//   ETHERSCAN_API_KEY=<your key> node deploy/verify-etherscan.mjs 0xContractAddress
//
// Get a free API key at https://etherscan.io/myapikey (Node 18+, no installs).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const address = process.argv[2];
const key = process.env.ETHERSCAN_API_KEY;
if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) { console.error("Usage: ETHERSCAN_API_KEY=... node deploy/verify-etherscan.mjs 0xContractAddress"); process.exit(1); }
if (!key) { console.error("Set ETHERSCAN_API_KEY (free at https://etherscan.io/myapikey)."); process.exit(1); }

const API = "https://api.etherscan.io/v2/api?chainid=1";
const WETH = "c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const input = readFileSync(join(here, "etherscan-standard-input.json"), "utf8");
const post = async (params) => {
  const r = await fetch(API, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...params, apikey: key }) });
  return r.json();
};
const get = async (params) => (await fetch(`${API}&${new URLSearchParams({ ...params, apikey: key })}`)).json();

const sub = await post({
  module: "contract", action: "verifysourcecode",
  contractaddress: address,
  sourceCode: input,
  codeformat: "solidity-standard-json-input",
  contractname: "contracts/GenericEvmSpotSettlement.sol:AonEvmSpotSettlement",
  compilerversion: "v0.8.26+commit.8a97fa7a",
  constructorArguements: WETH.padStart(64, "0"),
});
if (sub.status !== "1") {
  if (/already verified/i.test(sub.result ?? "")) { console.log(`✓ Already verified: https://etherscan.io/address/${address}#code`); process.exit(0); }
  console.error("✗ Etherscan refused the submission:", sub.result ?? sub.message); process.exit(1);
}
console.log("Submitted. Waiting for Etherscan to compile and compare…");
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const st = await get({ module: "contract", action: "checkverifystatus", guid: sub.result });
  if (/pending/i.test(st.result ?? "")) continue;
  if (st.status === "1" || /already verified/i.test(st.result ?? "")) { console.log(`✓ Verified: https://etherscan.io/address/${address}#code`); process.exit(0); }
  console.error("✗", st.result); process.exit(1);
}
console.error("✗ Still pending after 2.5 minutes; check the address on Etherscan later.");
process.exit(1);
