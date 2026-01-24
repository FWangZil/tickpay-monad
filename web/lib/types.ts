import type { Address } from "viem";

// Re-export Address for convenience
export type { Address };

/**
 * Session information from the contract
 */
export interface Session {
  sessionId: string;
  user: Address;
  policyId: bigint;
  startedAt: bigint;
  chargedSeconds: bigint;
  chargedAmount: bigint;
  lastChargeAt: bigint;
  closed: boolean;
  activelyCharging?: boolean;
}

/**
 * Policy information
 */
export interface Policy {
  keeper: Address;
  token: Address;
  payee: Address;
  ratePerSecond: bigint;
  maxCost: bigint;
  maxSeconds: bigint;
  expiry: bigint;
  enabled: boolean;
}

/**
 * EIP-712 Session Request
 */
export interface SessionRequest {
  user: Address;
  policyId: bigint;
  nonce: bigint;
  deadline: bigint;
}

/**
 * EIP-712 Typed Data
 */
export interface EIP712TypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Address;
  };
  types: {
    SessionRequest: Array<{ name: string; type: string }>;
  };
  message: {
    user: Address;
    policyId: string;
    nonce: string;
    deadline: string;
  };
}

/**
 * Session creation response
 */
export interface CreateSessionResponse {
  userAddress: Address;
  policyId: string;
  nonce: string;
  deadline: string;
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Address;
  };
  types: {
    SessionRequest: Array<{ name: string; type: string }>;
  };
  message: {
    user: Address;
    policyId: string;
    nonce: string;
    deadline: string;
  };
}

/**
 * Start session response
 */
export interface StartSessionResponse {
  success: boolean;
  sessionId: string;
  txHash: string;
  policyId: string;
  message: string;
}

/**
 * Stop session response
 */
export interface StopSessionResponse {
  success: boolean;
  closeTxHash: string;
  revokeTxHash?: string;
  message: string;
}

/**
 * Session status response
 */
export interface SessionStatusResponse {
  success: boolean;
  sessionId: string;
  user: Address;
  policyId: string;
  startedAt: string;
  chargedSeconds: string;
  chargedAmount: string;
  lastChargeAt: string;
  closed: boolean;
  activelyCharging?: boolean;
}

/**
 * Wallet connection state
 */
export interface WalletState {
  isConnected: boolean;
  address: Address | null;
  chainId: number | null;
}

/**
 * Video player state
 */
export interface VideoState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

/**
 * App state combining all states
 */
export interface AppState {
  wallet: WalletState;
  video: VideoState;
  session: Session | null;
  activeSessionId: string | null;
}
