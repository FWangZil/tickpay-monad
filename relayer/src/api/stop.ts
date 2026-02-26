import type { Request, Response } from "express";
import { stopSession } from "../session.js";

/**
 * POST /api/session/stop
 * Stop an active billing session
 */
export async function stopSessionHandler(req: Request, res: Response): Promise<void> {
  try {
    const { sessionId, userAddress, userPrivateKey } = req.body;

    if (!sessionId || !userAddress) {
      res.status(400).json({ error: "sessionId and userAddress are required" });
      return;
    }

    // Stop the session
    const result = await stopSession({
      sessionId,
      userAddress,
      userPrivateKey: userPrivateKey || undefined,
    });

    res.json({
      success: true,
      closeTxHash: result.closeTxHash ?? null,
      revokeTxHash: result.revokeTxHash,
      alreadyClosed: !!result.alreadyClosed,
      message: result.alreadyClosed ? "Session already closed (idempotent success)" : "Session stopped successfully",
    });
  } catch (error) {
    console.error("Error in stopSession:", error);
    res.status(500).json({
      error: "Failed to stop session",
      details: (error as Error).message,
    });
  }
}
