import type { Request, Response } from "express";
import { startSession } from "../session.js";

/**
 * POST /api/session/start
 * Start a new billing session with delegation
 */
export async function startSessionHandler(req: Request, res: Response): Promise<void> {
  try {
    const { userAddress, signature, userPrivateKey, policyId, authorizationList } = req.body;
    const normalizedAuthorizationList = Array.isArray(authorizationList)
      ? authorizationList.map((auth) => ({
          ...auth,
          chainId:
            typeof auth.chainId === "string"
              ? Number(auth.chainId)
              : Number(auth.chainId ?? 0),
          nonce:
            typeof auth.nonce === "string"
              ? Number(auth.nonce)
              : Number(auth.nonce ?? 0),
          v:
            typeof auth.v === "string"
              ? Number(auth.v)
              : auth.v,
          yParity:
            typeof auth.yParity === "string"
              ? Number(auth.yParity)
              : auth.yParity,
        }))
      : undefined;

    if (!userAddress || !signature) {
      res.status(400).json({ error: "userAddress and signature are required" });
      return;
    }

    // Start the session
    const result = await startSession({
      userAddress,
      userSignature: signature,
      userPrivateKey: userPrivateKey || undefined,
      authorizationList: normalizedAuthorizationList,
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
    const details =
      (error as { shortMessage?: string })?.shortMessage ??
      (error as { cause?: { shortMessage?: string } })?.cause?.shortMessage ??
      (error as Error).message;
    res.status(500).json({
      error: "Failed to start session",
      details,
    });
  }
}
