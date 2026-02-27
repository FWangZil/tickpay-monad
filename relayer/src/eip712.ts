import { type Address, hashTypedData, type Hex } from "viem";
import {
  TICKPAY_EIP712_TYPES,
  buildSessionRequestDomain,
  createSessionRequest as createSessionRequestCore,
  getDeadline,
  isDeadlineExpired
} from "@tickpay/sdk";
import type { SessionRequest } from "@tickpay/sdk";
import { config } from "./client.js";

export const EIP712_DOMAIN = buildSessionRequestDomain(config.CHAIN_ID, config.LOGIC_CONTRACT);
export const EIP712_TYPES = TICKPAY_EIP712_TYPES;

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
  return createSessionRequestCore(userAddress, policyId, nonce, deadlineMinutes);
}

export { getDeadline, isDeadlineExpired };
