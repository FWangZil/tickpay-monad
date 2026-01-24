import type { Request, Response } from "express";
import { startSession } from "../session.js";

/**
 * POST /api/session/start
 * Start a new billing session with delegation
 */
export async function startSessionHandler(req: Request, res: Response): Promise<void> {
  try {
    const { userAddress, signature, userPrivateKey, policyId } = req.body;

    if (!userAddress || !signature) {
      res.status(400).json({ error: "userAddress and signature are required" });
      return;
    }

    // Start the session
    const result = await startSession({
      userAddress,
      userSignature: signature,
      userPrivateKey: userPrivateKey || undefined,
      policyId: policyId ? BigInt(policyId) : undefined,
    });

    res.json({
      success: true,
      sessionId: result.sessionId,
      txHash: result.txHash,
      policyId: result.policyId.toString(),
      message: "Session started successfully",
    });
  } catch (error) {
    console.error("Error in startSession:", error);
    res.status(500).json({
      error: "Failed to start session",
      details: (error as Error).message,
    });
  }
}
