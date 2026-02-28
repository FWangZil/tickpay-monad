import "dotenv/config";
import { formatEther } from "viem";
import { ensureFetchPolyfill } from "./fetchPolyfill.js";
import { closeSessionEngine, resumeActiveSessions } from "./session.js";
import { sessionStoreConfig } from "./store.js";

const PORT = Number(process.env.PORT || "3001");

function printBanner(lines: string[]): void {
  const innerWidth = Math.max(...lines.map((line) => line.length), 0);
  const horizontal = "═".repeat(innerWidth + 2);

  console.log([
    "",
    `╔${horizontal}╗`,
    ...lines.map((line) => `║ ${line.padEnd(innerWidth)} ║`),
    `╚${horizontal}╝`,
    "",
  ].join("\n"));
}

async function getFaucetStatus() {
  try {
    const { keeperAccount, publicClient, config, ERC20_ABI } = await import("./client.js");
    const faucetAddress = keeperAccount.address;

    const [tickBalance, monBalance] = await Promise.all([
      publicClient.readContract({
        address: config.TOKEN,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [faucetAddress],
      }) as Promise<bigint>,
      publicClient.getBalance({ address: faucetAddress }),
    ]);

    return {
      faucetAddress,
      tick: `${formatEther(tickBalance)} TICK`,
      mon: `${formatEther(monBalance)} MON`,
    };
  } catch (error) {
    return {
      faucetAddress: "N/A",
      tick: `N/A (${(error as Error).message})`,
      mon: "N/A",
    };
  }
}

async function main() {
  ensureFetchPolyfill();

  // Validate required environment variables
  const requiredEnvVars = [
    "RPC_URL",
    "CHAIN_ID",
    "RELAYER_PRIVATE_KEY",
    "LOGIC_CONTRACT",
    "TOKEN",
    "PAYEE",
  ];

  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error("Missing required environment variables:");
    missing.forEach((key) => console.error(`  - ${key}`));
    console.error("\nPlease copy .env.example to .env and fill in the values.");
    process.exit(1);
  }

  // Create and start server
  const { createServer } = await import("./server.js");
  const app = createServer();

  await resumeActiveSessions();
  console.log(
    `[SessionStore] type=${sessionStoreConfig.SESSION_STORE} file=${sessionStoreConfig.SESSION_STORE_FILE}`
  );

  app.listen(PORT, async () => {
    const faucet = await getFaucetStatus();

    const lines = [
      "",
      "  TickPay Relayer - EIP-7702 Video Billing Service",
      "",
      `  Server running on: http://localhost:${PORT}`,
      `  Health check: http://localhost:${PORT}/health`,
      "",
      `  Environment: ${process.env.NODE_ENV || "development"}`,
      `  Chain ID: ${process.env.CHAIN_ID}`,
      `  Contract: ${process.env.LOGIC_CONTRACT}`,
      "",
      `  Tick Faucet: ${faucet.faucetAddress}`,
      `  Faucet TICK: ${faucet.tick}`,
      `  Faucet MON: ${faucet.mon}`,
      "",
    ];

    printBanner(lines);
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n\nShutting down gracefully...");
    closeSessionEngine()
      .catch((error) => console.error("Error closing session engine:", error))
      .finally(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    console.log("\n\nShutting down gracefully...");
    closeSessionEngine()
      .catch((error) => console.error("Error closing session engine:", error))
      .finally(() => process.exit(0));
  });
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
