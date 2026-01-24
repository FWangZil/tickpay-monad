import { createPublicClient, createWalletClient, http, type Address, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Monad chain configuration
export const monad: Chain = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.RPC_URL || "https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
};

// Environment variables
const RPC_URL = process.env.RPC_URL || "https://testnet-rpc.monad.xyz";
const CHAIN_ID = Number(process.env.CHAIN_ID || "10143");
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || "";
const LOGIC_CONTRACT = (process.env.LOGIC_CONTRACT || "0x") as Address;
const TOKEN = (process.env.TOKEN || "0x") as Address;
const PAYEE = (process.env.PAYEE || "0x") as Address;
const RATE_PER_SECOND = BigInt(process.env.RATE_PER_SECOND || "1000000000000000"); // 0.001 tokens
const CHARGE_INTERVAL_SEC = Number(process.env.CHARGE_INTERVAL_SEC || "10");

// Validate environment
if (!RELAYER_PRIVATE_KEY) {
  throw new Error("RELAYER_PRIVATE_KEY is required");
}
if (!LOGIC_CONTRACT || LOGIC_CONTRACT === "0x") {
  throw new Error("LOGIC_CONTRACT is required");
}
if (!TOKEN || TOKEN === "0x") {
  throw new Error("TOKEN is required");
}

// Create keeper account (relayer)
export const keeperAccount = privateKeyToAccount(RELAYER_PRIVATE_KEY as `0x${string}`);

// Public client for read operations
export const publicClient = createPublicClient({
  chain: monad,
  transport: http(RPC_URL),
});

// Wallet client for write operations (relayer signs txs)
export const walletClient = createWalletClient({
  account: keeperAccount,
  chain: monad,
  transport: http(RPC_URL),
});

// Contract ABI (minimal - only functions we use)
export const VIDEO_SESSION_LOGIC_ABI = [
  // Read functions
  {
    type: "function",
    name: "getSession",
    stateMutability: "view",
    inputs: [{ name: "sessionId", type: "bytes32" }],
    outputs: [
      { name: "user", type: "address" },
      { name: "policyId", type: "uint256" },
      { name: "startedAt", type: "uint256" },
      { name: "chargedSeconds", type: "uint256" },
      { name: "chargedAmount", type: "uint256" },
      { name: "lastChargeAt", type: "uint256" },
      { name: "closed", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getPolicy",
    stateMutability: "view",
    inputs: [{ name: "policyId", type: "uint256" }],
    outputs: [
      { name: "keeper", type: "address" },
      { name: "token", type: "address" },
      { name: "payee", type: "address" },
      { name: "ratePerSecond", type: "uint256" },
      { name: "maxCost", type: "uint256" },
      { name: "maxSeconds", type: "uint256" },
      { name: "expiry", type: "uint256" },
      { name: "enabled", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "sessionCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // Write functions
  {
    type: "function",
    name: "openSession",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "user", type: "address" },
          { name: "policyId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "sessionId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "charge",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sessionId", type: "bytes32" },
      { name: "secondsToBill", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "closeSession",
    stateMutability: "nonpayable",
    inputs: [{ name: "sessionId", type: "bytes32" }],
  },
  // Events
  {
    type: "event",
    name: "SessionOpened",
    inputs: [
      { name: "sessionId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "policyId", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SessionCharged",
    inputs: [
      { name: "sessionId", type: "bytes32", indexed: true },
      { name: "seconds", type: "uint256", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SessionClosed",
    inputs: [
      { name: "sessionId", type: "bytes32", indexed: true },
    ],
  },
] as const;

// ERC20 ABI for token operations
export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// Configuration exports
export const config = {
  LOGIC_CONTRACT,
  TOKEN,
  PAYEE,
  RATE_PER_SECOND,
  CHARGE_INTERVAL_SEC,
  CHAIN_ID,
};

// Session state (in-memory for demo - use database for production)
export interface SessionState {
  sessionId: string;
  userAddress: Address;
  policyId: bigint;
  startedAt: number;
  lastChargeAt: number;
  intervalId?: NodeJS.Timeout;
}

// Active sessions map
export const activeSessions = new Map<string, SessionState>();
