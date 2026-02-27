import { type Address, type Hash, type Hex, concatHex, encodePacked } from "viem";
import {
  buildAuthorization as buildSdkAuthorization,
  revokeDelegation as revokeSdkDelegation,
} from "@tickpay/sdk/server/eip7702";
import type { Authorization } from "@tickpay/sdk";
import { keeperAccount, monad, publicClient, walletClient } from "./client.js";

/**
 * Thin wrapper over SDK eip7702 authorization builder.
 */
export async function buildAuthorization(
  delegateContract: Address,
  userPrivateKey: Hex
): Promise<Authorization> {
  return buildSdkAuthorization({
    publicClient,
    userPrivateKey,
    delegateAddress: delegateContract,
    chainId: monad.id,
  });
}

export function buildAuthorizationList(authorizations: Authorization[]): Authorization[] {
  return authorizations;
}

/**
 * Legacy helper kept for compatibility with previous relayer APIs.
 */
export async function sendSetCodeTx(
  to: Address,
  data: Hex,
  authorizationList: Authorization[]
): Promise<Hash> {
  const hash = await walletClient.writeContract({
    address: to,
    abi: [
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
    ],
    functionName: "openSession",
    args: [
      {
        user: to as Address,
        policyId: 0n,
        nonce: 0n,
        deadline: 0n,
      },
      data,
    ],
    authorizationList: authorizationList as any,
  });

  return hash;
}

/**
 * Thin wrapper over SDK revoke implementation.
 */
export async function revokeDelegation(
  userAddress: Address,
  userPrivateKey: Hex
): Promise<Hash> {
  return revokeSdkDelegation({
    publicClient,
    walletClient,
    userAddress,
    userPrivateKey,
    chainId: monad.id,
    keeperAddress: keeperAccount.address,
  });
}

/**
 * Legacy helper kept for compatibility with previous relayer APIs.
 */
export function encodeDelegationCalldata(
  functionName: string,
  args: unknown[]
): Hex {
  if (functionName === "openSession") {
    const [request, signature] = args as [any, Hex];
    const functionSelector = "0x" + [117, 52, 119, 30].map((x) => x.toString(16).padStart(2, "0")).join("");
    const encodedRequest = encodePacked(
      ["address", "uint256", "uint256", "uint256"],
      [request.user, request.policyId, request.nonce, request.deadline]
    );
    const encoded = encodePacked(["bytes32", "bytes"], [encodedRequest as Hex, signature]);
    return concatHex([functionSelector as Hex, encoded]) as Hex;
  }

  return "0x";
}

export type { Authorization };
