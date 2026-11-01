"use client";
import { useEffect } from "react";

// A page whose scripts belong to an earlier release (a browser that cached the old page) fails to
// load them: one reload fixes that, so it's done once, by itself. Anything else is shown as it
// is, so a report says what happened.
const stale = (e: Error) => /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|Unexpected token '<'/i.test(`${e?.name} ${e?.message}`);

export function ErrorView({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    if (!stale(error)) return;
    try {
      const k = "covenant.reloaded", last = Number(sessionStorage.getItem(k) ?? 0);
      if (Date.now() - last > 60_000) { sessionStorage.setItem(k, String(Date.now())); location.reload(); }
    } catch {}
  }, [error]);
  return (
    <div style={{ maxWidth: 560, margin: "80px auto", padding: "0 24px", fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
      <h2 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong loading this page</h2>
      <p style={{ color: "#555" }}>{stale(error) ? "This page was from an earlier version of the site. Reloading usually fixes it." : "Reloading usually fixes it. If it keeps happening, please send us the line below."}</p>
      <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#f3f4f6", padding: 12, borderRadius: 8, fontSize: 13 }}>{`${error?.name ?? "Error"}: ${error?.message ?? ""}`.slice(0, 400)}</pre>
      <p style={{ display: "flex", gap: 12 }}>
        <button onClick={() => location.reload()} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ccc", cursor: "pointer" }}>Reload</button>
        <button onClick={() => reset()} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ccc", background: "none", cursor: "pointer" }}>Try again</button>
      </p>
    </div>
  );
}
