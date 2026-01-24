import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseSignature,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { hashAuthorization } from "viem/utils";

// Monad chain configuration
export const monad: Chain = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RPC_URL || "https://testnet-rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://testnet.monadexplorer.com" },
  },
};

// Environment variables
export const NEXT_PUBLIC_RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL || "http://localhost:3001";
export const NEXT_PUBLIC_LOGIC_CONTRACT = (process.env.NEXT_PUBLIC_LOGIC_CONTRACT || "0x") as Address;
export const NEXT_PUBLIC_TOKEN = (process.env.NEXT_PUBLIC_TOKEN || "0x") as Address;
export const NEXT_PUBLIC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "10143");

/**
 * Create a public client for read operations
 */
export function createPublicClientForChain() {
  return createPublicClient({
    chain: monad,
    transport: http(),
  });
}

/**
 * Create a wallet client for write operations using browser wallet
 */
export function createWalletClientForChain() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet found. Please install a wallet extension.");
  }

  return createWalletClient({
    chain: monad,
    transport: custom(window.ethereum),
  });
}

/**
 * Connect to wallet
 */
export async function connectWallet() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet found. Please install a wallet extension.");
  }

  try {
    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts",
    });

    return accounts[0] as Address;
  } catch (error) {
    console.error("Error connecting wallet:", error);
    throw error;
  }
}

/**
 * Get current wallet address
 */
export async function getWalletAddress(): Promise<Address | null> {
  if (typeof window === "undefined" || !window.ethereum) {
    return null;
  }

  try {
    const accounts = await window.ethereum.request({
      method: "eth_accounts",
    });

    return accounts[0] ? (accounts[0] as Address) : null;
  } catch (error) {
    console.error("Error getting wallet address:", error);
    return null;
  }
}

/**
 * Get current chain ID
 */
export async function getChainId(): Promise<number | null> {
  if (typeof window === "undefined" || !window.ethereum) {
    return null;
  }

  try {
    const chainId = await window.ethereum.request({
      method: "eth_chainId",
    });

    return Number(chainId);
  } catch (error) {
    console.error("Error getting chain ID:", error);
    return null;
  }
}

/**
 * Switch to Monad chain
 */
export async function switchToMonad() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet found.");
  }

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${NEXT_PUBLIC_CHAIN_ID.toString(16)}` }],
    });
  } catch (error: any) {
    // Chain doesn't exist, try to add it
    if (error.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${NEXT_PUBLIC_CHAIN_ID.toString(16)}`,
            chainName: "Monad",
            nativeCurrency: {
              name: "MON",
              symbol: "MON",
              decimals: 18,
            },
            rpcUrls: ["https://rpc.monad.xyz"],
            blockExplorerUrls: ["https://explorer.monad.xyz"],
          },
        ],
      });
    } else {
      throw error;
    }
  }
}

/**
 * Setup wallet event listeners
 */
export function setupWalletListeners(handlers: {
  onAccountsChanged?: (accounts: Address[]) => void;
  onChainChanged?: (chainId: string) => void;
  onDisconnect?: () => void;
}) {
  if (typeof window === "undefined" || !window.ethereum) {
    return () => {};
  }

  const handleAccountsChanged = (accounts: string[]) => {
    if (handlers.onAccountsChanged) {
      handlers.onAccountsChanged(accounts as Address[]);
    }
  };

  const handleChainChanged = (chainId: string) => {
    if (handlers.onChainChanged) {
      handlers.onChainChanged(chainId);
    }
  };

  const handleDisconnect = () => {
    if (handlers.onDisconnect) {
      handlers.onDisconnect();
    }
  };

  window.ethereum.on("accountsChanged", handleAccountsChanged);
  window.ethereum.on("chainChanged", handleChainChanged);
  window.ethereum.on("disconnect", handleDisconnect);

  // Return cleanup function
  return () => {
    if (window.ethereum) {
      window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener("chainChanged", handleChainChanged);
      window.ethereum.removeListener("disconnect", handleDisconnect);
    }
  };
}

export interface Authorization {
  address: Address;
  chainId: number;
  nonce: number;
  r: Hex;
  s: Hex;
  v?: number;
  yParity?: number;
}

export async function buildDelegationAuthorization(
  userAddress: Address,
  delegateContract: Address
): Promise<Authorization> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet found. Please install a wallet extension.");
  }

  const nonceHex = await window.ethereum.request({
    method: "eth_getTransactionCount",
    params: [userAddress, "latest"],
  });
  const nonce = Number(nonceHex);
  const chainId = NEXT_PUBLIC_CHAIN_ID;
  const authHash = hashAuthorization({
    address: delegateContract,
    chainId,
    nonce,
  });

  const signature = await window.ethereum.request({
    method: "eth_sign",
    params: [userAddress, authHash],
  });

  const signatureParts = parseSignature(signature as Hex);
  return {
    address: delegateContract,
    chainId,
    nonce,
    r: signatureParts.r,
    s: signatureParts.s,
    v: typeof signatureParts.v === "bigint" ? Number(signatureParts.v) : signatureParts.v,
    yParity:
      typeof signatureParts.yParity === "bigint"
        ? Number(signatureParts.yParity)
        : signatureParts.yParity,
  };
}

// Extend window interface for ethereum
declare global {
  interface Window {
    ethereum?: any;
  }
}
