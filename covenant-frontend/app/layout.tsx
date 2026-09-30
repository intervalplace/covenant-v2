import type { Metadata } from "next";
import Link from "next/link";
import { Providers } from "@/providers";
import { SiteNav } from "@/nav";
import "./globals.css";

export const metadata: Metadata = {
  // Absolute URLs for the social preview image; set to the deployed origin.
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined,
  title: "Covenant Markets — an order book without the exchange",
  description: "An order book without the exchange. Trade ETH, LINK and QNT for USDT from your own wallet; nothing moves until your terms are met on Ethereum.",
  openGraph: { title: "Covenant Markets", description: "An order book without the exchange.", siteName: "Covenant Markets" },
  twitter: { card: "summary_large_image", title: "Covenant Markets", description: "An order book without the exchange." },
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
              <Link href="/about">How it works</Link>
              <Link href="/docs">Docs</Link>
              <a href="https://explorer.aon.network" target="_blank" rel="noreferrer">AON Explorer</a>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
