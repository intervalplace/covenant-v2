import type { Metadata } from "next";
import Link from "next/link";
import { Providers } from "@/providers";
import { SiteNav } from "@/nav";
import { BuildInfo } from "@/buildinfo";
import "./globals.css";

export const metadata: Metadata = {
  // Absolute URLs for the social preview image; set to the deployed origin.
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined,
  title: "Covenant",
  description: "Trade CSD for USDC from your own wallet. The seller is paid only once it arrives. Settled on Ethereum.",
  openGraph: { title: "Covenant", description: "Trade CSD for USDC from your own wallet. The seller is paid only once it arrives.", siteName: "Covenant" },
  twitter: { card: "summary_large_image", site: "@covenantmarket", title: "Covenant", description: "Trade CSD for USDC from your own wallet. The seller is paid only once it arrives." },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <SiteNav />
          {children}
          <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 24px 40px" }}>
            <footer className="site-footer">
              <span>Covenant runs on <a href="https://aon.network" target="_blank" rel="noreferrer">AON</a> and settles on Ethereum.</span>
              <span className="spacer" />
              <BuildInfo />
              <Link href="/about">How it works</Link>
              <Link href="/docs">Docs</Link>
              <a href="https://explorer.aon.network" target="_blank" rel="noreferrer">AON Explorer</a>
              <a href="https://x.com/covenantmarket" target="_blank" rel="noreferrer" title="The official Covenant account on X">@covenantmarket</a>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
