"use client";

import { useEffect, useState } from "react";

/**
 * Which exact build is this? A build can't contain its own IPFS CID (the CID
 * is a hash of the build), so it's discovered at runtime:
 *   1. a subdomain gateway URL: <cid>.ipfs.<gateway>/
 *   2. a path gateway URL: /ipfs/<cid>/
 *   3. the gateway's response headers (X-Ipfs-Roots / X-Ipfs-Path), for any
 *      gateway or host that doesn't put the CID in the URL
 * Otherwise it shows the git commit the build came from.
 */

const CID_RE = /^(bafy[a-z2-7]{40,}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/;

function cidFromUrl(): string | null {
  const sub = window.location.hostname.split(".");
  const i = sub.indexOf("ipfs");
  if (i > 0 && CID_RE.test(sub[i - 1])) return sub[i - 1];
  const m = window.location.pathname.match(/^\/ipfs\/([^/]+)/);
  return m && CID_RE.test(m[1]) ? m[1] : null;
}

async function cidFromHeaders(): Promise<string | null> {
  try {
    const r = await fetch(window.location.origin + "/", { method: "HEAD", cache: "no-store" });
    const roots = r.headers.get("x-ipfs-roots")?.split(",")[0]?.trim();
    if (roots && CID_RE.test(roots)) return roots;
    const path = r.headers.get("x-ipfs-path")?.match(/^\/ipfs\/([^/]+)/)?.[1];
    return path && CID_RE.test(path) ? path : null;
  } catch { return null; }
}

export function BuildInfo() {
  const [cid, setCid] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const fromUrl = cidFromUrl();
    if (fromUrl) { setCid(fromUrl); setChecked(true); return; }
    cidFromHeaders().then(c => { setCid(c); setChecked(true); });
  }, []);
  if (!checked) return null;
  const commit = process.env.NEXT_PUBLIC_BUILD_ID;
  return cid ? (
    <span title={`You're running the build with IPFS CID ${cid}. Nobody can change what this CID serves.`}>
      Build <a href={`https://${cid}.ipfs.dweb.link/`} target="_blank" rel="noreferrer" className="mono">{cid.slice(0, 10)}…{cid.slice(-6)}</a>
    </span>
  ) : commit ? (
    <span title="Not served from IPFS. This is the source commit it was built from.">Build {commit}</span>
  ) : null;
}
