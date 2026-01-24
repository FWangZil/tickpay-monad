import type { Request, Response } from "express";
import { publicClient, config } from "../client.js";
import { createSessionRequest, getDeadline } from "../eip712.js";

/**
 * POST /api/session/create
 * Generate unsigned EIP-712 data for user to sign
 */
export async function createSession(req: Request, res: Response): Promise<void> {
  try {
    const { userAddress, policyId } = req.body;

    if (!userAddress) {
      res.status(400).json({ error: "userAddress is required" });
      return;
    }

    // Get current nonce for user
    const nonce = await publicClient.readContract({
      address: config.LOGIC_CONTRACT,
      abi: [
        {
          type: "function",
          name: "nonces",
          stateMutability: "view",
          inputs: [{ name: "", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
        },
      ],
      functionName: "nonces",
      args: [userAddress],
    });

    // Create session request
    const policyIdToUse = policyId ? BigInt(policyId) : 0n;
    const deadline = getDeadline(3600); // 1 hour
    const request = createSessionRequest(userAddress, policyIdToUse, nonce as bigint, 60);

    // Return typed data for wallet to sign
    res.json({
      userAddress: request.user,
      policyId: request.policyId.toString(),
      nonce: request.nonce.toString(),
      deadline: request.deadline.toString(),
      // EIP-712 domain and types for wallet signing
      domain: {
        name: "TickPay",
        version: "1",
        chainId: config.CHAIN_ID,
        verifyingContract: config.LOGIC_CONTRACT,
      },
      types: {
        SessionRequest: [
          { name: "user", type: "address" },
          { name: "policyId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      message: {
        user: request.user,
        policyId: request.policyId.toString(),
        nonce: request.nonce.toString(),
        deadline: request.deadline.toString(),
      },
    });
  } catch (error) {
    console.error("Error in createSession:", error);
    res.status(500).json({ error: "Failed to create session request" });
  }
}
