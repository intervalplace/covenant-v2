#!/usr/bin/env node
/**
 * Build Covenant as a static site, pack it for IPFS, and (optionally) pin it.
 *
 *   npm run release:ipfs                 build + pack, print the CID
 *   IPFS_API=http://127.0.0.1:5001 npm run release:ipfs
 *                                        ...and import + pin it on that IPFS node
 *
 * Env:
 *   IPFS_API        Kubo RPC endpoint (your own node, or a pinning service
 *                   that speaks the Kubo RPC API). Optional.
 *   IPFS_API_AUTH   Value for the Authorization header, if the API needs one.
 *   BUILD_ID        Override the build id (defaults to the git commit), which
 *                   keeps builds reproducible.
 *   --skip-build    Pack the existing ./out without rebuilding.
 *
 * The same commit always produces the same CID, so anyone can verify a
 * release by rebuilding it.
 */
import { spawnSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", ...opts });
  if (r.status !== 0) { console.error(`\n✗ ${cmd} ${args.join(" ")} failed`); process.exit(r.status ?? 1); }
  return (r.stdout ?? "").trim();
};

// Releases build only from committed settings (.env.production), so anyone
// can rebuild the same CID from the commit. A local override would break that.
for (const f of [".env.local", ".env.production.local"]) {
  if (existsSync(f)) { console.error(`✗ ${f} exists. Move it aside: releases build only from the committed .env.production.`); process.exit(1); }
}
if (!existsSync(".env.production")) { console.error("✗ No .env.production. Create it from .env.production.example and commit it."); process.exit(1); }
{
  const env = readFileSync(".env.production", "utf8");
  const addr = (env.match(/^NEXT_PUBLIC_EVM_SPOT_SETTLEMENT=(.*)$/m)?.[1] ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr) || /^0x0{40}$/.test(addr)) {
    console.error(`✗ .env.production: NEXT_PUBLIC_EVM_SPOT_SETTLEMENT is "${addr}". Set it to the deployed contract address and commit.`);
    process.exit(1);
  }
}

let commit = "unknown";
try { commit = execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch {}
const buildId = process.env.BUILD_ID || commit;

if (!process.argv.includes("--skip-build")) {
  console.log(`Building static site (build id ${buildId})…`);
  run("npx", ["next", "build"], { stdio: "inherit", env: { ...process.env, BUILD_ID: buildId, NEXT_TELEMETRY_DISABLED: "1" } });
}
if (!existsSync("out/index.html")) { console.error("✗ out/index.html missing — is output: 'export' set?"); process.exit(1); }

mkdirSync("release", { recursive: true });
const car = `release/covenant-${buildId}.car`;
console.log("Packing for IPFS…");
const packed = run("npx", ["ipfs-car", "pack", "out", "--output", car]);
const cid = packed.split(/\s+/).pop();
const roots = run("npx", ["ipfs-car", "roots", car]);
if (!roots.includes(cid)) { console.error(`✗ CAR root ${roots} doesn't match ${cid}`); process.exit(1); }

let pinned = null;
if (process.env.IPFS_API) {
  const api = process.env.IPFS_API.replace(/\/+$/, "");
  console.log(`Importing and pinning on ${api}…`);
  const form = new FormData();
  form.append("file", new Blob([readFileSync(car)]), "covenant.car");
  const headers = process.env.IPFS_API_AUTH ? { Authorization: process.env.IPFS_API_AUTH } : {};
  const res = await fetch(`${api}/api/v0/dag/import?pin-roots=true`, { method: "POST", body: form, headers });
  const text = await res.text();
  if (!res.ok || !text.includes(cid)) { console.error(`✗ Import failed (${res.status}): ${text.slice(0, 300)}`); process.exit(1); }
  pinned = api;
  console.log(`✓ Pinned ${cid}`);
}

const record = { cid, buildId, commit, createdAt: new Date().toISOString(), car, carBytes: statSync(car).size, pinnedOn: pinned };
writeFileSync(`release/covenant-${buildId}.json`, JSON.stringify(record, null, 2) + "\n");

console.log(`
Covenant ${buildId}
  CID      ${cid}
  Preview  https://${cid}.ipfs.dweb.link/
  Archive  ${car}

Next:
  1. Pin it in more than one place (upload the .car to any pinning service,
     or run: ipfs dag import ${car}).
  2. Announce the CID everywhere at once (release notes, posts), with the
     commit and the contract address, so anyone can rebuild and check it.
  3. Add it to the list of release CIDs in the repo.

This CID will serve exactly this build forever. A fix is a new release.
`);
