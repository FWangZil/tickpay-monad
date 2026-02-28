import type { Request, Response } from "express";
import { getSessionStatus, stopSession } from "../session.js";

const CONFLICT_ERROR_PATTERNS = [
  "higher priority",
  "nonce too low",
  "already known",
  "replacement transaction underpriced",
];

function isTxPriorityConflict(error: unknown): boolean {
  const message =
    (error as { shortMessage?: string })?.shortMessage ??
    (error as { cause?: { shortMessage?: string } })?.cause?.shortMessage ??
    (error as Error).message;
  if (!message) return false;
  const normalized = message.toLowerCase();
  return CONFLICT_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

    const conflictError = isTxPriorityConflict(error);
    if (conflictError) {
      const { sessionId, userAddress } = req.body;

      // A competing tx using the same nonce likely won. Poll chain state and return idempotent success when closed.
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const status = await getSessionStatus(sessionId, userAddress);
          if (status?.closed) {
            res.json({
              success: true,
              closeTxHash: null,
              revokeTxHash: undefined,
              alreadyClosed: true,
              message: "Session already closed by higher-priority transaction (idempotent success)",
            });
            return;
          }
        } catch {
          // Ignore transient read errors while pending tx is being mined.
        }
        await wait(1200);
      }

      res.status(409).json({
        error: "Stop transaction is in progress",
        code: "stop_in_progress",
        details: "A higher-priority transaction for this account is pending. Please retry in a few seconds.",
      });
      return;
    }

    res.status(500).json({
      error: "Failed to stop session",
      details: (error as Error).message,
    });
  }
}
