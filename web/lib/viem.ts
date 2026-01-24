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
export const NEXT_PUBLIC_RELAYER_URL = "https://api-tickpay.ngrok.app";
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

/**
 * Check if an address has an existing EIP-7702 delegation
 * EIP-7702 delegated accounts have code starting with 0xef0100 followed by the delegate address
 * @returns The delegate contract address if delegated, null otherwise
 */
export async function checkExistingDelegation(userAddress: Address): Promise<Address | null> {
  try {
    const publicClient = createPublicClientForChain();
    const code = await publicClient.getCode({ address: userAddress });

    // EIP-7702 delegation code format: 0xef0100 + 20-byte address (total 23 bytes = 46 hex chars + 0x prefix)
    // Example: 0xef0100<delegateAddress>
    if (code && code.startsWith("0xef0100") && code.length === 48) {
      const delegateAddress = `0x${code.slice(8)}` as Address;
      console.log("Found existing delegation to:", delegateAddress);
      return delegateAddress;
    }

    return null;
  } catch (error) {
    console.error("Error checking delegation:", error);
    return null;
  }
}

export async function buildDelegationAuthorization(
  userAddress: Address,
  delegateContract: Address
): Promise<Authorization> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet found. Please install a wallet extension.");
  }

  // Get nonce first
  const nonceHex = await window.ethereum.request({
    method: "eth_getTransactionCount",
    params: [userAddress, "latest"],
  });
  const nonce = BigInt(nonceHex);
  const chainId = NEXT_PUBLIC_CHAIN_ID;

  // Helper to parse result
  const parseResult = (signatureOrObj: any) => {
    let r: Hex, s: Hex, v: bigint | undefined, yParity: bigint | undefined;

    if (typeof signatureOrObj === 'string') {
      const parts = parseSignature(signatureOrObj as Hex);
      r = parts.r;
      s = parts.s;
      v = parts.v ? BigInt(parts.v) : undefined;
      yParity = parts.yParity !== undefined ? BigInt(parts.yParity) : undefined;
    } else {
       // Assume object return
       const sig = signatureOrObj as any;
       r = sig.r;
       s = sig.s;
       v = sig.v ? BigInt(sig.v) : undefined;
       yParity = sig.yParity ? BigInt(sig.yParity) : undefined;

      // Handle undefined v/yParity if not present in object but part of signature
       if (v === undefined && yParity === undefined && sig.yParity) yParity = BigInt(sig.yParity);
       if (v === undefined && yParity === undefined && sig.v) v = BigInt(sig.v);
    }
    return { r, s, v, yParity };
  };

  let sigData: { r: Hex; s: Hex; v?: bigint; yParity?: bigint } | null = null;
  let lastError: any = null;

  // Strategy 1: wallet_signAuthorization (Standard)
  try {
    console.log("Attempting Strategy 1: wallet_signAuthorization");
    const res = await window.ethereum.request({
      method: "wallet_signAuthorization",
      params: [{
        chainId: `0x${chainId.toString(16)}`,
        address: delegateContract,
        nonce: nonceHex,
      }],
    });
    console.log("Strategy 1 Success");
    sigData = parseResult(res);
  } catch (e) {
    console.warn("wallet_signAuthorization failed, trying experimental...", e);
    lastError = e;
  }

  // Strategy 2: wallet_experimental_signAuthorization (Experimental prefix)
  if (!sigData) {
    try {
      console.log("Attempting Strategy 2: wallet_experimental_signAuthorization");
      const res = await window.ethereum.request({
        method: "wallet_experimental_signAuthorization",
        params: [{
          chainId: `0x${chainId.toString(16)}`,
          address: delegateContract,
          nonce: nonceHex,
        }],
      });
      console.log("Strategy 2 Success");
      sigData = parseResult(res);
    } catch (e) {
      console.warn("wallet_experimental_signAuthorization failed, trying eth_sign7702Authorization...", e);
      lastError = e;
    }
  }

  // Strategy 3: eth_sign7702Authorization (Privy-style method)
  if (!sigData) {
    try {
      console.log("Attempting Strategy 3: eth_sign7702Authorization");
      const res = await window.ethereum.request({
        method: "eth_sign7702Authorization",
        params: [{
          chainId: chainId,
          contractAddress: delegateContract,
          nonce: Number(nonce),
        }],
      });
      console.log("Strategy 3 Success");
      sigData = parseResult(res);
    } catch (e) {
      console.warn("eth_sign7702Authorization failed...", e);
      lastError = e;
    }
  }

  // Strategy 4: Try with different parameter format (contractAddress instead of address)
  if (!sigData) {
    try {
      console.log("Attempting Strategy 4: wallet_signAuthorization with contractAddress param");
      const res = await window.ethereum.request({
        method: "wallet_signAuthorization",
        params: [{
          chainId: chainId,
          contractAddress: delegateContract,
          nonce: Number(nonce),
        }],
      });
      console.log("Strategy 4 Success");
      sigData = parseResult(res);
    } catch (e) {
      console.warn("Strategy 4 failed...", e);
      lastError = e;
    }
  }

  // If no signing method worked, throw an error
  // DO NOT use eth_sign - it adds a message prefix that makes the signature invalid for EIP-7702
  if (!sigData) {
    console.error("Wallet does not support EIP-7702 signing methods. Tried: wallet_signAuthorization, wallet_experimental_signAuthorization, eth_sign7702Authorization");
    throw new Error(
      "Your wallet does not support EIP-7702 signing. " +
      "Please use a wallet that supports EIP-7702, such as MetaMask with Smart Accounts Kit or a compatible wallet."
    );
  }

  console.log("Authorization Signature Data:", {
    r: sigData.r,
    s: sigData.s,
    v: sigData.v,
    yParity: sigData.yParity
  });

  return {
    address: delegateContract,
    chainId,
    nonce: Number(nonce),
    r: sigData.r,
    s: sigData.s,
    v: sigData.v ? Number(sigData.v) : undefined,
    yParity: sigData.yParity !== undefined ? Number(sigData.yParity) : undefined,
  };
}

// Extend window interface for ethereum
declare global {
  interface Window {
    ethereum?: any;
  }
}
