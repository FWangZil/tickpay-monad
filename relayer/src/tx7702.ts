import { type Address, type Hash, type Hex, toBytes, concatHex, keccak256, encodePacked, createWalletClient, createPublicClient, http } from "viem";
import { walletClient, publicClient, monad } from "./client.js";

/**
 * EIP-7702 Authorization structure
 */
export interface Authorization {
  contractAddress: Address;
  nonce: bigint;
  signature: Hex;
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
  const { privateKeyToAccount, sign } = await import("viem/accounts");

  // Create account from private key
  const account = privateKeyToAccount(userPrivateKey);

  // Get current nonce for the account
  const nonce = await publicClient.getTransactionCount({
    address: account.address,
  });

  // Sign the authorization
  // EIP-7702 authorization signature: sign(keccak256(abi.encodePacked(contractAddress, nonce)))
  const authHash = keccak256(
    encodePacked(
      ["address", "uint256"],
      [delegateContract, BigInt(nonce)]
    )
  );

  const signature = await account.signMessage({
    message: { raw: authHash },
  });

  return {
    contractAddress: delegateContract,
    nonce: BigInt(nonce),
    signature: signature as Hex,
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
