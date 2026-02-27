import "dotenv/config";
import { ensureFetchPolyfill } from "./fetchPolyfill.js";
import { closeSessionEngine, resumeActiveSessions } from "./session.js";
import { sessionStoreConfig } from "./store.js";

const PORT = Number(process.env.PORT || "3001");

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

  app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   TickPay Relayer - EIP-7702 Video Billing Service        ║
║                                                           ║
║   Server running on: http://localhost:${PORT}                   ║
║   Health check: http://localhost:${PORT}/health               ║
║                                                           ║
║   Environment: ${process.env.NODE_ENV || "development"}                          ║
║   Chain ID: ${process.env.CHAIN_ID}                                    ║
║   Contract: ${process.env.LOGIC_CONTRACT}    ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
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
