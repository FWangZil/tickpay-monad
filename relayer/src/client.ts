import { createPublicClient, createWalletClient, http, type Address, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ERC20_ABI, MONAD_TESTNET_CHAIN, VIDEO_SESSION_LOGIC_ABI } from "@tickpay/sdk";

const RPC_URL = process.env.RPC_URL || "https://testnet-rpc.monad.xyz";
const CHAIN_ID = Number(process.env.CHAIN_ID || "10143");
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || "";
const LOGIC_CONTRACT = (process.env.LOGIC_CONTRACT || "0x") as Address;
const TOKEN = (process.env.TOKEN || "0x") as Address;
const PAYEE = (process.env.PAYEE || "0x") as Address;
const RATE_PER_SECOND = BigInt(process.env.RATE_PER_SECOND || "1000000000000000");
const CHARGE_INTERVAL_SEC = Number(process.env.CHARGE_INTERVAL_SEC || "10");

// Monad chain configuration with RPC override from environment.
export const monad: Chain = {
  ...MONAD_TESTNET_CHAIN,
  rpcUrls: {
    ...MONAD_TESTNET_CHAIN.rpcUrls,
    default: { http: [RPC_URL] }
  }
};

if (!RELAYER_PRIVATE_KEY) {
  throw new Error("RELAYER_PRIVATE_KEY is required");
}
if (!LOGIC_CONTRACT || LOGIC_CONTRACT === "0x") {
  throw new Error("LOGIC_CONTRACT is required");
}
if (!TOKEN || TOKEN === "0x") {
  throw new Error("TOKEN is required");
}

export const keeperAccount = privateKeyToAccount(RELAYER_PRIVATE_KEY as `0x${string}`);

export const publicClient = createPublicClient({
  chain: monad,
  transport: http(RPC_URL)
});

export const walletClient = createWalletClient({
  account: keeperAccount,
  chain: monad,
  transport: http(RPC_URL)
});

export { VIDEO_SESSION_LOGIC_ABI, ERC20_ABI };

export const config = {
  LOGIC_CONTRACT,
  TOKEN,
  PAYEE,
  RATE_PER_SECOND,
  CHARGE_INTERVAL_SEC,
  CHAIN_ID
};
