import { type Address, hashTypedData, type Hex } from "viem";

// Environment variables
const NEXT_PUBLIC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "143");
const NEXT_PUBLIC_LOGIC_CONTRACT = (process.env.NEXT_PUBLIC_LOGIC_CONTRACT || "0x") as Address;

// EIP-712 Domain
export const EIP712_DOMAIN = {
  name: "TickPay",
  version: "1",
  chainId: NEXT_PUBLIC_CHAIN_ID,
  verifyingContract: NEXT_PUBLIC_LOGIC_CONTRACT,
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

/**
 * Hash EIP-712 typed data for session request
 */
export function hashSessionRequest(data: {
  user: Address;
  policyId: bigint;
  nonce: bigint;
  deadline: bigint;
}): Hex {
  return hashTypedData({
    domain: EIP712_DOMAIN,
    types: EIP712_TYPES,
    primaryType: "SessionRequest",
    message: data,
  });
}

/**
 * Sign session request using wallet client
 */
export async function signSessionRequest(
  walletClient: any,
  data: {
    user: Address;
    policyId: bigint;
    nonce: bigint;
    deadline: bigint;
  }
): Promise<Hex> {
  try {
    const signature = await walletClient.signTypedData({
      account: data.user,
      domain: EIP712_DOMAIN,
      types: EIP712_TYPES,
      primaryType: "SessionRequest",
      message: {
        user: data.user,
        policyId: data.policyId,
        nonce: data.nonce,
        deadline: data.deadline,
      },
    });

    return signature as Hex;
  } catch (error) {
    console.error("Error signing session request:", error);
    throw error;
  }
}

/**
 * Verify signature locally (optional - for pre-validation)
 */
export function verifySessionRequest(
  data: {
    user: Address;
    policyId: bigint;
    nonce: bigint;
    deadline: bigint;
  },
  signature: Hex,
  expectedSigner: Address
): boolean {
  const hash = hashSessionRequest(data);
  // In production, you'd verify the signature here
  // For now, the contract will handle verification
  return true;
}
