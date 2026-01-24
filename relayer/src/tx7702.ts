import { type Address, type Hash, type Hex, toBytes, concatHex, keccak256, encodePacked } from "viem";
import { walletClient, publicClient } from "./client.js";

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
      [delegateContract, nonce]
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
  const { privateKeyToAccount } = await import("viem/accounts");

  // Create account from private key
  const account = privateKeyToAccount(userPrivateKey);

  // Get current nonce
  const nonce = await publicClient.getTransactionCount({
    address: account.address,
  });

  // Sign authorization for 0x0 (revocation)
  const authHash = keccak256(
    encodePacked(
      ["address", "uint256"],
      ["0x0000000000000000000000000000000000000000" as Address, BigInt(nonce)]
    )
  );

  const signature = await account.signMessage({
    message: { raw: authHash },
  });

  // Create wallet client for user
  const userWalletClient = (await import("viem")).then(({ createWalletClient, http }) =>
    createWalletClient({
      account,
      chain: (await import("./client.js")).monad,
      transport: http((await import("./client.js")).process.env.RPC_URL || "https://rpc.monad.xyz"),
    })
  );

  const client = await userWalletClient;

  // Send type 4 transaction with delegation to 0x0
  const hash = await client.sendTransaction({
    account,
    to: userAddress,
    data: "0x",
    authorizationList: [
      {
        contractAddress: "0x0000000000000000000000000000000000000000" as Address,
        nonce: BigInt(nonce),
        signature: signature as Hex,
      },
    ],
  });

  return hash;
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
