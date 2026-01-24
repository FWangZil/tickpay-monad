import type { Request, Response } from "express";
import { getSessionStatus } from "../session.js";
import { activeSessions, type SessionState } from "../client.js";

/**
 * GET /api/session/status/:sessionId
 * Get session status from contract
 */
export async function getSessionStatusHandler(req: Request, res: Response): Promise<void> {
  try {
    const { sessionId } = req.params;
    const id = Array.isArray(sessionId) ? sessionId[0] : sessionId;

    if (!id) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    // Get session from contract
    const status = await getSessionStatus(id);
    if (!status) {
      res.status(404).json({
        error: "Session not found",
        sessionId: id,
        activelyCharging: false,
      });
      return;
    }

    // Check if session is actively charging
    const activeSession = activeSessions.get(id);

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
      activelyCharging: !!activeSession,
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
    const sessions = Array.from(activeSessions.values()).map((s: SessionState) => ({
      sessionId: s.sessionId,
      userAddress: s.userAddress,
      policyId: s.policyId.toString(),
      startedAt: s.startedAt,
      lastChargeAt: s.lastChargeAt,
      activelyCharging: !!s.intervalId,
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
