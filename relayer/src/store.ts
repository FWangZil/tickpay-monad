import path from "node:path";
import { createSessionStore } from "@tickpay/sdk/server/sessionStore";

const SESSION_STORE = (process.env.SESSION_STORE || "file").toLowerCase();
const SESSION_STORE_FILE =
  process.env.SESSION_STORE_FILE || path.join(process.cwd(), ".tickpay", "sessions.json");

export const sessionStore = createSessionStore({
  type: SESSION_STORE === "memory" ? "memory" : "file",
  filePath: SESSION_STORE_FILE,
  logger: console,
});

export const sessionStoreConfig = {
  SESSION_STORE,
  SESSION_STORE_FILE,
};
