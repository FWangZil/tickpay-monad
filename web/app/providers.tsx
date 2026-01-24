"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { defineChain } from "viem";

// Define Monad Testnet chain
const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: {
      name: "Monad Explorer",
      url: "https://testnet.monadexplorer.com",
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  console.log("Privy App ID:", appId ? `${appId.slice(0, 8)}...` : "NOT SET");

  if (!appId || appId === "YOUR_PRIVY_APP_ID_HERE") {
    console.error("NEXT_PUBLIC_PRIVY_APP_ID is not set or invalid");
    // Return children without Privy wrapper to avoid crash
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#8338ec",
          logo: "/logo.png",
        },
        loginMethods: ["wallet", "email"],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
        supportedChains: [monadTestnet],
        defaultChain: monadTestnet,
      }}
    >
      {children}
    </PrivyProvider>
  );
}
