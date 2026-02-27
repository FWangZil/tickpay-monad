import type { Request, Response } from "express";
import { publicClient, config } from "../client.js";
import {
  NONCES_ABI,
  buildSessionRequestTypedData,
  createSessionRequest,
} from "@tickpay/sdk";

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
    // In EIP-7702, nonces are stored in user's address storage, not logic contract
    // Try to read from user's address first, default to 0n for first-time users
    let nonce: bigint = 0n;
    try {
      nonce = await publicClient.readContract({
        address: userAddress, // Read from user's address (where EIP-7702 stores state)
        abi: NONCES_ABI,
        functionName: "nonces",
        args: [userAddress],
      }) as bigint;
    } catch (e) {
      // User hasn't delegated yet or first time - use nonce 0
      console.log("Could not read nonce from user address, using 0 (first-time user)");
      nonce = 0n;
    }

    // Create session request
    const policyIdToUse = policyId ? BigInt(policyId) : 0n;
    const request = createSessionRequest(userAddress, policyIdToUse, nonce as bigint, 60);
    const typedData = buildSessionRequestTypedData(config.CHAIN_ID, userAddress, request);

    // Return typed data for wallet to sign
    res.json({
      userAddress: request.user,
      policyId: request.policyId.toString(),
      nonce: request.nonce.toString(),
      deadline: request.deadline.toString(),
      // EIP-712 domain and types for wallet signing
      // IMPORTANT: verifyingContract must be the user's EOA (delegated via EIP-7702)
      domain: typedData.domain,
      types: typedData.types,
      message: typedData.message,
    });
  } catch (error) {
    console.error("Error in createSession:", error);
    res.status(500).json({ error: "Failed to create session request" });
  }
}
