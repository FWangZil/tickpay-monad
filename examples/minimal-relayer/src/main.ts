import "dotenv/config";
import express from "express";
import cors from "cors";
import { createPublicClient, createWalletClient, http, type Address, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  MONAD_TESTNET_CHAIN,
  NONCES_ABI,
  VIDEO_SESSION_LOGIC_ABI,
  buildSessionRequestTypedData,
  createSessionRequest,
} from "@tickpay/sdk";
import { createTickPaySessionEngine } from "@tickpay/sdk/server/sessionEngine";
import { createSessionStore } from "@tickpay/sdk/server/sessionStore";
import {
  buildAuthorization as buildEip7702Authorization,
  revokeDelegation as revokeEip7702Delegation,
} from "@tickpay/sdk/server/eip7702";

const PORT = Number(process.env.PORT || "3002");
const RPC_URL = process.env.RPC_URL || "https://testnet-rpc.monad.xyz";
const CHAIN_ID = Number(process.env.CHAIN_ID || "10143");
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || "";
const LOGIC_CONTRACT = (process.env.LOGIC_CONTRACT || "0x") as Address;
const TOKEN = (process.env.TOKEN || "0x") as Address;
const PAYEE = (process.env.PAYEE || "0x") as Address;
const RATE_PER_SECOND = BigInt(process.env.RATE_PER_SECOND || "1000000000000000");
const CHARGE_INTERVAL_SEC = Number(process.env.CHARGE_INTERVAL_SEC || "10");
const SESSION_STORE = (process.env.SESSION_STORE || "file").toLowerCase();
const SESSION_STORE_FILE = process.env.SESSION_STORE_FILE || ".tickpay/sessions.json";

const required = ["RELAYER_PRIVATE_KEY", "LOGIC_CONTRACT", "TOKEN", "PAYEE"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}

const chain: Chain = {
  ...MONAD_TESTNET_CHAIN,
  id: CHAIN_ID,
  rpcUrls: {
    ...MONAD_TESTNET_CHAIN.rpcUrls,
    default: { http: [RPC_URL] },
  },
};

const relayerAccount = privateKeyToAccount(RELAYER_PRIVATE_KEY as `0x${string}`);
const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
});
const walletClient = createWalletClient({
  account: relayerAccount,
  chain,
  transport: http(RPC_URL),
});

const sessionStore = createSessionStore({
  type: SESSION_STORE === "memory" ? "memory" : "file",
  filePath: SESSION_STORE_FILE,
  logger: console,
});

const engine = createTickPaySessionEngine({
  publicClient,
  walletClient,
  videoSessionLogicAbi: VIDEO_SESSION_LOGIC_ABI,
  config: {
    LOGIC_CONTRACT,
    TOKEN,
    PAYEE,
    RATE_PER_SECOND,
    CHARGE_INTERVAL_SEC,
  },
  keeperAddress: relayerAccount.address,
  sessionStore,
  buildAuthorization: async (delegateContract, userPrivateKey) =>
    buildEip7702Authorization({
      publicClient,
      userPrivateKey,
      delegateAddress: delegateContract,
      chainId: chain.id,
    }),
  revokeDelegation: async (userAddress, userPrivateKey) =>
    revokeEip7702Delegation({
      publicClient,
      walletClient,
      userAddress,
      userPrivateKey,
      chainId: chain.id,
      keeperAddress: relayerAccount.address,
    }),
});

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "tickpay-minimal-relayer",
    chainId: chain.id,
    store: SESSION_STORE,
  });
});

app.post("/api/session/create", async (req, res) => {
  try {
    const { userAddress, policyId } = req.body;
    if (!userAddress) {
      res.status(400).json({ error: "userAddress is required" });
      return;
    }

    let nonce: bigint = 0n;
    try {
      nonce = (await publicClient.readContract({
        address: userAddress as Address,
        abi: NONCES_ABI,
        functionName: "nonces",
        args: [userAddress as Address],
      })) as bigint;
    } catch {
      nonce = 0n;
    }

    const request = createSessionRequest(
      userAddress as Address,
      policyId ? BigInt(policyId) : 0n,
      nonce,
      60
    );
    const typedData = buildSessionRequestTypedData(chain.id, userAddress as Address, request);

    res.json({
      userAddress: request.user,
      policyId: request.policyId.toString(),
      nonce: request.nonce.toString(),
      deadline: request.deadline.toString(),
      domain: typedData.domain,
      types: typedData.types,
      message: typedData.message,
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/session/start", async (req, res) => {
  try {
    const { userAddress, signature, userPrivateKey, policyId, authorizationList, deadline, nonce, payee } =
      req.body;
    if (!userAddress || !signature) {
      res.status(400).json({ error: "userAddress and signature are required" });
      return;
    }

    const result = await engine.startSession({
      userAddress,
      userSignature: signature,
      userPrivateKey: userPrivateKey || undefined,
      authorizationList,
      policyId: policyId !== undefined ? BigInt(policyId) : undefined,
      deadline: deadline !== undefined ? BigInt(deadline) : undefined,
      nonce: nonce !== undefined ? BigInt(nonce) : undefined,
      payee: payee || undefined,
    });

    res.json({
      success: true,
      sessionId: result.sessionId,
      txHash: result.txHash,
      policyId: result.policyId.toString(),
      message: "Session started successfully",
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to start session",
      details: (error as Error).message,
    });
  }
});

app.post("/api/session/stop", async (req, res) => {
  try {
    const { sessionId, userAddress, userPrivateKey } = req.body;
    if (!sessionId || !userAddress) {
      res.status(400).json({ error: "sessionId and userAddress are required" });
      return;
    }

    const result = await engine.stopSession({
      sessionId,
      userAddress,
      userPrivateKey: userPrivateKey || undefined,
    });

    res.json({
      success: true,
      closeTxHash: result.closeTxHash ?? null,
      revokeTxHash: result.revokeTxHash,
      alreadyClosed: !!result.alreadyClosed,
      message: "Session stopped successfully",
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to stop session",
      details: (error as Error).message,
    });
  }
});

app.get("/api/session/status/:sessionId", async (req, res) => {
  try {
    const id = req.params.sessionId;
    const cached = engine.getCachedSession(id);
    if (cached) {
      const now = Math.floor(Date.now() / 1000);
      const chargedSeconds = now - cached.startedAt;
      const chargedAmount = BigInt(chargedSeconds) * RATE_PER_SECOND;
      res.json({
        success: true,
        sessionId: id,
        user: cached.userAddress,
        policyId: cached.policyId.toString(),
        startedAt: cached.startedAt.toString(),
        chargedSeconds: chargedSeconds.toString(),
        chargedAmount: chargedAmount.toString(),
        lastChargeAt: cached.lastChargeAt.toString(),
        closed: false,
        activelyCharging: engine.isCharging(id),
      });
      return;
    }

    const onchain = await engine.getSessionStatus(id);
    if (!onchain) {
      res.status(404).json({ error: "Session not found", sessionId: id, activelyCharging: false });
      return;
    }

    res.json({
      success: true,
      sessionId: id,
      user: onchain.user,
      policyId: onchain.policyId.toString(),
      startedAt: onchain.startedAt.toString(),
      chargedSeconds: onchain.chargedSeconds.toString(),
      chargedAmount: onchain.chargedAmount.toString(),
      lastChargeAt: onchain.lastChargeAt.toString(),
      closed: onchain.closed,
      activelyCharging: false,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to get status", details: (error as Error).message });
  }
});

app.get("/api/sessions/active", (_req, res) => {
  const sessions = engine.listCachedSessions().map((s) => ({
    sessionId: s.sessionId,
    userAddress: s.userAddress,
    policyId: s.policyId.toString(),
    startedAt: s.startedAt,
    lastChargeAt: s.lastChargeAt,
    activelyCharging: engine.isCharging(s.sessionId),
  }));
  res.json({
    success: true,
    count: sessions.length,
    sessions,
  });
});

async function start() {
  await engine.resumeActiveSessions();
  app.listen(PORT, () => {
    console.log(
      `[minimal-relayer] listening on http://localhost:${PORT} (store=${SESSION_STORE} file=${SESSION_STORE_FILE})`
    );
  });
}

process.on("SIGINT", () => {
  engine
    .close()
    .catch((error) => console.error("Error closing engine:", error))
    .finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  engine
    .close()
    .catch((error) => console.error("Error closing engine:", error))
    .finally(() => process.exit(0));
});

start().catch((error) => {
  console.error("Failed to start minimal relayer:", error);
  process.exit(1);
});
