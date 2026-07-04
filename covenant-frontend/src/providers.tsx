"use client";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defineChain } from "viem";

const hardhat = defineChain({
  id: 31337,
  name: "Hardhat",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

const isDev = process.env.NEXT_PUBLIC_CHAIN_ID === "31337";

// Two separate configs to satisfy TypeScript — transports must match chains exactly
const mainnetConfig = createConfig({
  chains:     [mainnet],
  connectors: [injected()],
  transports: { [mainnet.id]: http() },
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
