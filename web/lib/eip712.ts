import { type Address, hashTypedData, type Hex } from "viem";
import {
  TICKPAY_EIP712_TYPES,
  buildSessionRequestDomain
} from "@tickpay/sdk";

const NEXT_PUBLIC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "10143");
const NEXT_PUBLIC_LOGIC_CONTRACT = (process.env.NEXT_PUBLIC_LOGIC_CONTRACT || "0x") as Address;

export const EIP712_DOMAIN = buildSessionRequestDomain(
  NEXT_PUBLIC_CHAIN_ID,
  NEXT_PUBLIC_LOGIC_CONTRACT
);
export const EIP712_TYPES = TICKPAY_EIP712_TYPES;

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

export async function signSessionRequest(
  walletClient: any,
  data: {
    user: Address;
    policyId: bigint;
    nonce: bigint;
    deadline: bigint;
  }
): Promise<Hex> {
  const signature = await walletClient.signTypedData({
    account: data.user,
    domain: EIP712_DOMAIN,
    types: EIP712_TYPES,
    primaryType: "SessionRequest",
    message: data,
  });
  return signature as Hex;
}

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
  return true;
}
