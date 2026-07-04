/**
 * Covenant proof server.
 * In production: proxies real CSD SPV proofs from Compute Substrate.
 * In local test: /v1/csd/proof/mock returns a synthetic valid proof.
 */

import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { createHash } from "node:crypto";

const app  = Fastify({ logger: false });
await app.register(cors, { origin: true });

const CSD_RPC = process.env.CSD_RPC_URL ?? "https://api.computesubstrate.org";
const PORT    = Number(process.env.PORT ?? 4747);

// ── Crypto helpers (for mock proof) ──────────────────────────────────────────
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();
const dsha   = (b: Buffer) => sha256(sha256(b));
const u32le  = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u64le  = (n: bigint)  => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };

// ── Mock proof for local testing ──────────────────────────────────────────────
// Returns a synthetic CSD SPV proof that passes on-chain verification
// with the test oracle registered in deploy-local.mjs.
// The proof is deterministic given the same inputs so the same txid
// always produces the same valid proof.

app.get("/v1/csd/proof/mock/:txid", async (req) => {
  const { txid } = (req.params as any);
  const prevHex   = (req.query as any).prev ?? ("aa".repeat(32));
  const cleanPrev = prevHex.replace("0x", "").padStart(64, "0");

  const sellerScript20 = Buffer.from("cd".repeat(20), "hex");
  // amount: the actual CSD satoshis being paid — must match auth.csdAmount
  const CSD_AMOUNT = BigInt((req.query as any).amount ?? "100000000");

  const seedBuf     = Buffer.from(txid.replace("0x", "").padStart(64, "0").slice(0, 64), "hex");
  const seedHash    = sha256(seedBuf);
  const uniqueNonce = seedHash.readUInt32LE(0);

  const rawTxBuf = Buffer.concat([
    u32le(uniqueNonce), u64le(0n), u64le(1n),
    u64le(CSD_AMOUNT), u64le(20n), sellerScript20,
  ]);
  const txidBuf = dsha(rawTxBuf);

  const TEST_BITS   = 0x1f7fffff;
  const testMant    = BigInt(TEST_BITS & 0xFFFFFF);
  const testExp     = BigInt(TEST_BITS >> 24);
  const TEST_TARGET = testMant << (8n * (testExp - 3n));

  const prevBuf   = Buffer.from(cleanPrev, "hex");
  const blockTime = Math.floor(Date.now() / 1000);
  let validNonce  = 0;
  let blockHashBuf: Buffer | null = null;

  for (let nonce = 0; nonce < 1_000_000; nonce++) {
    const h  = Buffer.concat([u32le(1), prevBuf, txidBuf, u64le(BigInt(blockTime)), u32le(TEST_BITS), u32le(nonce)]);
    const bh = dsha(h);
    if (BigInt("0x" + bh.toString("hex")) <= TEST_TARGET) {
      validNonce   = nonce;
      blockHashBuf = bh;
      break;
    }
  }
  if (!blockHashBuf) throw new Error("Could not mine test block");

  const blockHash = "0x" + blockHashBuf.toString("hex");
  const txidHex   = "0x" + txidBuf.toString("hex");

  return {
    ok: true,
    proof: {
      ok: true, confirmations: 1,
      txid: txidHex, block_hash: blockHash, height: 1000,
      genesis_hash: "0x00000052c2821f71b19c3d79dfabfb12d4076ba15d83b47d008e582aad6c0d52",
      tx_raw: "0x" + rawTxBuf.toString("hex"),
      tx: {
        txid: txidHex,
        outputs: [{ script_pubkey: "0x" + sellerScript20.toString("hex"), value: CSD_AMOUNT.toString() }],
      },
      header: { version: 1, prev: "0x" + cleanPrev, merkle: txidHex, time: blockTime, bits: TEST_BITS, nonce: validNonce },
      merkle_branch: [],
    },
  };
});


// ── Real CSD proof proxy ──────────────────────────────────────────────────────
app.get<{ Params: { txid: string } }>("/v1/csd/proof/:txid", async (req, reply) => {
  const { txid } = req.params;
  try {
    const res = await fetch(`${CSD_RPC}/proof/tx/${txid}`);
    if (!res.ok) {
      if (res.status === 404) return reply.code(404).send({ ok: false, error: "CSD_TX_NOT_FOUND" });
      return reply.code(502).send({ ok: false, error: `CSD_RPC_ERROR_${res.status}` });
    }
    return { ok: true, proof: await res.json() };
  } catch (err: any) {
    return reply.code(502).send({ ok: false, error: err?.message ?? "CSD_FETCH_FAILED" });
  }
});

// ── CSD UTXO balance ──────────────────────────────────────────────────────────
app.get<{ Params: { address: string } }>("/v1/csd/utxos/:address", async (req, reply) => {
  try {
    const res = await fetch(`${CSD_RPC}/utxos/${req.params.address}`);
    if (!res.ok) return reply.code(502).send({ ok: false, error: `CSD_RPC_ERROR_${res.status}` });
    return { ok: true, ...await res.json() };
  } catch (err: any) {
    return reply.code(502).send({ ok: false, error: err?.message ?? "CSD_FETCH_FAILED" });
  }
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/health", () => ({ ok: true, service: "covenant-server-v1" }));

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`[covenant-server] :${PORT} — CSD RPC: ${CSD_RPC}`);
console.log(`[covenant-server] Mock proof: GET /v1/csd/proof/mock/:txid`);
