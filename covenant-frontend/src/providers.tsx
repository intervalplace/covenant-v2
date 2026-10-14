"use client";
import { WagmiProvider, createConfig, http, fallback, custom } from "wagmi";
import { rpcPlan, walletReader } from "./endpoints";
import { mainnet } from "wagmi/chains";
import { injected } from "@wagmi/core";
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
  const eth = typeof window !== "undefined" ? (window as any).ethereum : undefined;
  return fallback([
    ...override.map(u => http(u)),
    ...(eth ? [custom(walletReader(eth, mainnet.id))] : []),
    ...rest.map(u => http(u)),
  ]);
}

const mainnetConfig = createConfig({
  chains:     [mainnet],
  connectors: [injected()],
  transports: { [mainnet.id]: mainnetTransport() },
  ssr: true,
});

const hardhatConfig = createConfig({
  chains:     [hardhat],
  connectors: [injected()],
  transports: { [hardhat.id]: http("http://127.0.0.1:8545") },
  ssr: true,
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
