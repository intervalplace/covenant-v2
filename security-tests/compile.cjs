// Compiles the settlement contract (from the vendored namespace) and the test
// mocks with the production settings into artifacts.json.
const solc = require("solc"), fs = require("fs"), path = require("path");
if (!solc.version().startsWith("0.8.26")) { console.error("solc " + solc.version() + "; expected 0.8.26 (npm ci)"); process.exit(1); }
const sources = {
  "GenericEvmSpotSettlement.sol": { content: fs.readFileSync(path.join(__dirname, "../aon-namespace-evm-spot/src/contracts/GenericEvmSpotSettlement.sol"), "utf8") },
  "Mocks.sol": { content: fs.readFileSync(path.join(__dirname, "Mocks.sol"), "utf8") },
};
const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources,
  settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "cancun", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } })));
for (const e of out.errors ?? []) if (e.severity === "error") { console.error(e.formattedMessage); process.exit(1); }
const art = {};
for (const f in out.contracts) for (const n in out.contracts[f]) art[n] = { abi: out.contracts[f][n].abi, bytecode: "0x" + out.contracts[f][n].evm.bytecode.object };
fs.writeFileSync(path.join(__dirname, "artifacts.json"), JSON.stringify(art));
console.log("compiled:", Object.keys(art).join(" "));
