import type { Request, Response } from "express";
import {
  getCachedSession,
  getSessionStatus,
  isSessionCharging,
  listCachedSessions
} from "../session.js";

/**
 * GET /api/session/status/:sessionId
 * Get session status - primarily from cached active sessions in sessionStore
 * Note: In EIP-7702, session data is stored in user's address, not the logic contract.
 * After delegation ends, we can't read from user's address, so we use cached store data.
 */
export async function getSessionStatusHandler(req: Request, res: Response): Promise<void> {
  try {
    const { sessionId } = req.params;
    const id = Array.isArray(sessionId) ? sessionId[0] : sessionId;

    if (!id) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    // First check cached active sessions
    const activeSession = getCachedSession(id);

    if (activeSession) {
      // Calculate estimated charged amount based on elapsed time
      const now = Math.floor(Date.now() / 1000);
      const elapsedSeconds = now - activeSession.startedAt;
      const ratePerSecond = BigInt(process.env.RATE_PER_SECOND || "1000000000000000");
      const estimatedCharged = BigInt(elapsedSeconds) * ratePerSecond;

      res.json({
        success: true,
        sessionId: id,
        user: activeSession.userAddress,
        policyId: activeSession.policyId.toString(),
        startedAt: activeSession.startedAt.toString(),
        chargedSeconds: elapsedSeconds.toString(),
        chargedAmount: estimatedCharged.toString(),
        lastChargeAt: activeSession.lastChargeAt.toString(),
        closed: false,
        activelyCharging: isSessionCharging(id),
      });
      return;
    }

    // Try to get from contract (may fail if EIP-7702 delegation ended)
    try {
      const status = await getSessionStatus(id);
      if (status) {
        res.json({
          success: true,
          sessionId: id,
          user: status.user,
          policyId: status.policyId.toString(),
          startedAt: status.startedAt.toString(),
          chargedSeconds: status.chargedSeconds.toString(),
          chargedAmount: status.chargedAmount.toString(),
          lastChargeAt: status.lastChargeAt.toString(),
          closed: status.closed,
          activelyCharging: false,
        });
        return;
      }
    } catch (contractError) {
      console.log("Could not read session from contract (EIP-7702 delegation may have ended)");
    }

    // Session not found in memory or contract
    res.status(404).json({
      error: "Session not found",
      sessionId: id,
      activelyCharging: false,
    });
  } catch (error) {
    console.error("Error in getSessionStatus:", error);
    res.status(500).json({
      error: "Failed to get session status",
      details: (error as Error).message,
    });
  }
}

/**
 * GET /api/sessions/active
 * Get all actively charging sessions
 */
export async function getActiveSessionsHandler(req: Request, res: Response): Promise<void> {
  try {
    const sessions = listCachedSessions().map((s) => ({
      sessionId: s.sessionId,
      userAddress: s.userAddress,
      policyId: s.policyId.toString(),
      startedAt: s.startedAt,
      lastChargeAt: s.lastChargeAt,
      activelyCharging: isSessionCharging(s.sessionId),
    }));

    res.json({
      success: true,
      count: sessions.length,
      sessions,
    });
  } catch (error) {
    console.error("Error in getActiveSessions:", error);
    res.status(500).json({
      error: "Failed to get active sessions",
      details: (error as Error).message,
    });
  }
}
