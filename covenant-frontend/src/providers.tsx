"use client";
import { WagmiProvider, createConfig, http, fallback, custom } from "wagmi";
import { rpcPlan, walletReader, safeEthereum } from "./endpoints";
import { mainnet } from "wagmi/chains";
import { injected } from "@wagmi/core";
import { walletConnect } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defineChain } from "viem";

const hardhat = defineChain({
  id: 31337,
  name: "Hardhat",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

const isDev = process.env.NEXT_PUBLIC_CHAIN_ID === "31337";

// Ethereum connection, in priority order: the RPC the user set in
// Connections, then their own wallet (once connected and on mainnet), then
// NEXT_PUBLIC_ETH_RPC_URL and public fallbacks. If one fails, the next is used.
function mainnetTransport() {
  const { override, rest } = rpcPlan();
  const eth = typeof window !== "undefined" ? safeEthereum((() => { try { return (window as any).ethereum; } catch { return undefined; } })()) : undefined;
  return fallback([
    ...override.map(u => http(u)),
    ...(eth ? [custom(walletReader(eth, mainnet.id))] : []),
    ...rest.map(u => http(u)),
  ]);
}

// The browser's wallet, through safeEthereum (see there). Used for every Connect button.
export const browserWallet = injected({ target: () => ({ id: "injected", name: "Browser wallet",
  provider: (w?: any) => safeEthereum((() => { try { return w?.ethereum; } catch { return undefined; } })()) }) });

// A wallet on another device (usually a phone), through WalletConnect: a QR code on desktop, a
// link to the wallet app on mobile. Only when a WalletConnect project id is configured.
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID || "";
export const phoneWallet = WC_PROJECT_ID ? walletConnect({
  projectId: WC_PROJECT_ID,
  showQrModal: true,
  metadata: {
    name: "Covenant",
    description: "Trade straight from your wallet. Settled on Ethereum.",
    url: typeof window !== "undefined" ? window.location.origin : (process.env.NEXT_PUBLIC_SITE_URL || "https://covenant.market"),
    icons: [(process.env.NEXT_PUBLIC_SITE_URL || "https://covenant.market") + "/apple-icon.png"],
  },
}) : undefined;

const mainnetConfig = createConfig({
  chains:     [mainnet],
  connectors: phoneWallet ? [browserWallet, phoneWallet] : [browserWallet],
  transports: { [mainnet.id]: mainnetTransport() },
  ssr: true,
  multiInjectedProviderDiscovery: false, // (only the wallet above, through the safe wrapper)
});

const hardhatConfig = createConfig({
  chains:     [hardhat],
  connectors: [browserWallet],
  transports: { [hardhat.id]: http("http://127.0.0.1:8545") },
  ssr: true,
  multiInjectedProviderDiscovery: false, // (only the wallet above, through the safe wrapper)
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  const config = isDev ? hardhatConfig : mainnetConfig;
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
