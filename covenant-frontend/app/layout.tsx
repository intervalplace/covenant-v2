import type { Metadata } from "next";
import Link from "next/link";
import { Providers } from "@/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Covenant",
  description: "Execution no longer requires trust.",
};

function Nav() {
  return (
    <nav style={{
      borderBottom: "1px solid var(--border)",
      padding: "0 32px",
      height: 48,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      position: "sticky",
      top: 0,
      background: "var(--bg)",
      zIndex: 100,
    }}>
      <Link href="/" style={{
        fontFamily: "var(--serif)",
        fontSize: 15,
        letterSpacing: "0.01em",
        color: "var(--fg)",
      }}>
        Covenant
      </Link>
      <div style={{ display: "flex", gap: 28, fontSize: 14, color: "var(--muted)" }}>
        <Link href="/">Market</Link>
        <Link href="/about">About</Link>
        <Link href="/docs">Docs</Link>
      </div>
    </nav>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
