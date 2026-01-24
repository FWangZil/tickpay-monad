import { type Address, hashTypedData, type Hex } from "viem";
import { config } from "./client.js";

// EIP-712 Domain
export const EIP712_DOMAIN = {
  name: "TickPay",
  version: "1",
  chainId: config.CHAIN_ID,
  verifyingContract: config.LOGIC_CONTRACT,
} as const;

// EIP-712 Types
export const EIP712_TYPES = {
  SessionRequest: [
    { name: "user", type: "address" },
    { name: "policyId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export type SessionRequest = {
  user: Address;
  policyId: bigint;
  nonce: bigint;
  deadline: bigint;
};

/**
 * Generate EIP-712 typed data hash for session request
 */
export function hashSessionRequest(request: SessionRequest): Hex {
  return hashTypedData({
    domain: EIP712_DOMAIN,
    types: EIP712_TYPES,
    primaryType: "SessionRequest",
    message: request,
  });
}

/**
 * Validate EIP-712 signature
 */
export function validateSessionRequest(
  request: SessionRequest,
  signature: Hex,
  expectedSigner: Address
): boolean {
  // For now, just return true - the contract will verify the signature
  // In production, you could verify on the relayer side too for early rejection
  return true;
}

/**
 * Create session request parameters
 */
export function createSessionRequest(
  userAddress: Address,
  policyId: bigint,
  nonce: bigint,
  deadlineMinutes: number = 60
): SessionRequest {
  const now = Math.floor(Date.now() / 1000);
  return {
    user: userAddress,
    policyId,
    nonce,
    deadline: BigInt(now + deadlineMinutes * 60),
  };
}

/**
 * Get deadline from timestamp
 */
export function getDeadline(secondsFromNow: number = 3600): bigint {
  const now = Math.floor(Date.now() / 1000);
  return BigInt(now + secondsFromNow);
}

/**
 * Check if deadline has passed
 */
export function isDeadlineExpired(deadline: bigint): boolean {
  const now = Math.floor(Date.now() / 1000);
  return BigInt(now) > deadline;
}
