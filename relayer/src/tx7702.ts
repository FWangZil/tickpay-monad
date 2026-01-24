import { type Address, type Hash, type Hex, concatHex, encodePacked } from "viem";
import type { Signature } from "viem";
import { walletClient, publicClient, monad } from "./client.js";

/**
 * EIP-7702 Authorization structure
 */
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
 * Build EIP-7702 authorization for delegation
 * @param delegateContract The contract to delegate to (VideoSessionLogic)
 * @param userPrivateKey User's private key to sign the authorization
 * @returns Authorization object ready for type 4 transaction
 */
export async function buildAuthorization(
  delegateContract: Address,
  userPrivateKey: Hex
): Promise<Authorization> {
  const { privateKeyToAccount } = await import("viem/accounts");

  const account = privateKeyToAccount(userPrivateKey);
  const nonce = await publicClient.getTransactionCount({
    address: account.address,
  });

  const authorization = await account.signAuthorization({
    address: delegateContract,
    chainId: monad.id,
    nonce,
  });

  const signature = authorization as Signature;
  return {
    address: delegateContract,
    chainId: Number(authorization.chainId),
    nonce: Number(authorization.nonce),
    r: signature.r,
    s: signature.s,
    v: typeof signature.v === "bigint" ? Number(signature.v) : signature.v,
    yParity:
      typeof signature.yParity === "bigint"
        ? Number(signature.yParity)
        : signature.yParity,
  };
}

/**
 * Build authorization list for type 4 transaction
 * @param authorizations Array of authorizations
 * @returns Formatted authorization list for viem
 */
export function buildAuthorizationList(authorizations: Authorization[]): Authorization[] {
  return authorizations;
}

/**
 * Send a type 4 transaction with EIP-7702 authorization list
 * This delegates the user's account to the contract and calls the function
 *
 * @param to The contract address to call (user's EOA)
 * @param data The calldata to execute
 * @param authorizationList EIP-7702 authorization list
 * @returns Transaction hash
 */
export async function sendSetCodeTx(
  to: Address,
  data: Hex,
  authorizationList: Authorization[]
): Promise<Hash> {
  try {
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
          policyId: 0n, // Will be set from actual policy
          nonce: 0n,
          deadline: 0n,
        },
        data,
      ],
      // @ts-ignore - viem supports authorizationList in type 4
      authorizationList,
    });

    return hash;
  } catch (error) {
    console.error("Error sending setCode tx:", error);
    throw error;
  }
}

/**
 * Revoke EIP-7702 delegation by setting delegate to 0x0
 *
 * @param userAddress The user's EOA address
 * @param userPrivateKey User's private key to sign revocation
 * @returns Transaction hash
 */
export async function revokeDelegation(
  userAddress: Address,
  userPrivateKey: Hex
): Promise<Hash> {
  // TODO: Implement EIP-7702 delegation revocation
  // This requires sending a type 4 transaction with authorizationList
  // For now, return a placeholder hash
  console.log("Revoking delegation for", userAddress);
  return "0x" as Hash;
}

/**
 * Manually encode delegation transaction data
 * This is a fallback if viem's authorizationList is not fully supported
 */
export function encodeDelegationCalldata(
  functionName: string,
  args: unknown[]
): Hex {
  // For openSession: encode the function call
  if (functionName === "openSession") {
    const [request, signature] = args as [any, Hex];

    // Function selector for openSession((address,uint256,uint256,uint256),bytes)
    const functionSelector = "0x" + [
      117, 52, 119, 30, // First 4 bytes of keccak256("openSession((address,uint256,uint256,uint256),bytes)")
    ].map(x => x.toString(16).padStart(2, "0")).join("");

    // Encode the struct
    const encodedRequest = encodePacked(
      ["address", "uint256", "uint256", "uint256"],
      [request.user, request.policyId, request.nonce, request.deadline]
    );

    // Encode offset and data
    const encoded = encodePacked(
      ["bytes32", "bytes"],
      [encodedRequest as Hex, signature]
    );

    return concatHex([functionSelector as Hex, encoded]) as Hex;
  }

  return "0x";
}
