/**
 * Checks that a website serves exactly the local release build in ./out,
 * file by file (sha-256). Use it to confirm a domain serves the same build as
 * the published IPFS CID.
 *
 *   npm run check-site -- https://covenant.market
 *
 * To check someone else's deployment: check out the release commit, run
 * `npm ci && npm run release:ipfs` (same CID as announced), then this.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createHash } from "node:crypto";

const base = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(base)) { console.error("Usage: npm run check-site -- https://your.domain"); process.exit(1); }
if (!existsSync("out")) { console.error("No ./out build. Run `npm run release:ipfs` first."); process.exit(1); }

const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
walk("out");
const sha = (b) => createHash("sha256").update(b).digest("hex");
// out/about/index.html is served at /about/ ; everything else at its own path
const urlFor = (rel) => rel === "index.html" ? "/" : rel.endsWith("/index.html") ? "/" + rel.slice(0, -"index.html".length) : "/" + rel;

let ok = 0; const bad = [];
const queue = files.map((p) => relative("out", p).split(sep).join("/")).filter((r) => r !== "404.html");
await Promise.all(Array.from({ length: 8 }, async () => {
  for (let rel; (rel = queue.shift()); ) {
    const url = base + urlFor(rel);
    try {
      const r = await fetch(url, { cache: "no-store", redirect: "follow" });
      const body = Buffer.from(await r.arrayBuffer());
      if (r.ok && sha(body) === sha(readFileSync(join("out", rel)))) ok++;
      else bad.push(`${r.ok ? "differs " : `HTTP ${r.status}`}  ${url}`);
    } catch (e) { bad.push(`unreachable  ${url}`); }
  }
}));
if (bad.length) { console.error(bad.join("\n")); console.error(`\n✗ ${bad.length} of ${ok + bad.length} files don't match the local build.`); process.exit(1); }
console.log(`✓ ${base} serves this build exactly (${ok} files match).`);
