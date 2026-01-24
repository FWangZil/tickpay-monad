import {
  type Address,
  type Hash,
  type Hex,
  decodeErrorResult,
  type TransactionReceipt,
} from "viem";
import { publicClient, walletClient, VIDEO_SESSION_LOGIC_ABI, config, activeSessions, type SessionState } from "./client.js";
import { buildAuthorization } from "./tx7702.js";

export interface StartSessionParams {
  userAddress: Address;
  userSignature: Hex; // EIP-712 signature for session request
  userPrivateKey?: Hex; // Optional: for demo mode with test key
  policyId?: bigint;
}

export interface ChargeParams {
  sessionId: string;
  secondsToBill?: number;
}

export interface StopSessionParams {
  sessionId: string;
  userAddress: Address;
  userPrivateKey?: Hex; // Optional: for demo mode with test key
}

/**
 * Start a new billing session
 * 1. Verifies EIP-712 signature
 * 2. Sends type 4 transaction with EIP-7702 delegation (if private key provided)
 * 3. Calls openSession on the contract
 * 4. Starts periodic charging loop
 */
export async function startSession(params: StartSessionParams): Promise<{
  sessionId: string;
  txHash: Hash;
  policyId: bigint;
}> {
  const { userAddress, userSignature, userPrivateKey, policyId = 0n } = params;

  // Decode the signature to get request parameters
  // In production, you'd get these from the API call
  const nonce = await publicClient.readContract({
    address: config.LOGIC_CONTRACT,
    abi: VIDEO_SESSION_LOGIC_ABI,
    functionName: "nonces",
    args: [userAddress],
  });

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now

  // Build session request
  const request = {
    user: userAddress,
    policyId,
    nonce,
    deadline,
  };

  try {
    let txHash: Hash;

    if (userPrivateKey) {
      // Demo mode: Use type 4 transaction with EIP-7702 delegation
      const auth = await buildAuthorization(config.LOGIC_CONTRACT, userPrivateKey);

      // @ts-ignore - EIP-7702 support
      txHash = await walletClient.writeContract({
        address: userAddress, // Call the user's EOA (delegated)
        abi: VIDEO_SESSION_LOGIC_ABI,
        functionName: "openSession",
        args: [request, userSignature],
        authorizationList: [auth],
      });
    } else {
      // Production mode: User has already delegated via wallet
      // Relayer just sends the call to user's delegated account
      txHash = await walletClient.writeContract({
        address: userAddress,
        abi: VIDEO_SESSION_LOGIC_ABI,
        functionName: "openSession",
        args: [request, userSignature],
      });
    }

    // Wait for transaction
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    // Parse SessionOpened event to get sessionId
    const sessionOpenedEvent = receipt.logs.find((log) => {
      try {
        const decoded = publicClient.decodeEventLog({
          abi: VIDEO_SESSION_LOGIC_ABI,
          eventName: "SessionOpened",
          data: log.data,
          topics: log.topics,
        });
        return decoded.eventName === "SessionOpened";
      } catch {
        return false;
      }
    });

    let sessionId = "";
    if (sessionOpenedEvent) {
      const decoded = publicClient.decodeEventLog({
        abi: VIDEO_SESSION_LOGIC_ABI,
        data: sessionOpenedEvent.data,
        topics: sessionOpenedEvent.topics,
      });
      sessionId = (decoded as any).args.sessionId as string;
    } else {
      // Fallback: generate sessionId from tx hash
      sessionId = txHash;
    }

    // Store session state
    const sessionState: SessionState = {
      sessionId,
      userAddress,
      policyId,
      startedAt: Math.floor(Date.now() / 1000),
      lastChargeAt: Math.floor(Date.now() / 1000),
    };
    activeSessions.set(sessionId, sessionState);

    // Start charging loop
    startChargingLoop(sessionId);

    return { sessionId, txHash, policyId };
  } catch (error) {
    console.error("Error starting session:", error);
    throw error;
  }
}

/**
 * Charge a session for elapsed time
 * Called by the periodic charging loop
 */
export async function chargeSession(params: ChargeParams): Promise<{
  txHash: Hash;
  secondsBilled: number;
  amountCharged: bigint;
}> {
  const { sessionId, secondsToBill } = params;

  const sessionState = activeSessions.get(sessionId);
  if (!sessionState) {
    throw new Error("Session not found");
  }

  try {
    // Calculate seconds to bill if not provided
    let seconds = secondsToBill;
    if (!seconds) {
      const now = Math.floor(Date.now() / 1000);
      seconds = now - sessionState.lastChargeAt;
      sessionState.lastChargeAt = now;
    }

    // Don't charge if less than 1 second
    if (seconds < 1) {
      return { txHash: "0x" as Hash, secondsBilled: 0, amountCharged: 0n };
    }

    // Send charge transaction
    const txHash = await walletClient.writeContract({
      address: sessionState.userAddress, // Call the user's delegated EOA
      abi: VIDEO_SESSION_LOGIC_ABI,
      functionName: "charge",
      args: [sessionId as `0x${string}`, BigInt(seconds)],
    });

    // Wait for transaction
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    // Get amount from event
    let amountCharged = 0n;
    const chargeEvent = receipt.logs.find((log) => {
      try {
        const decoded = publicClient.decodeEventLog({
          abi: VIDEO_SESSION_LOGIC_ABI,
          eventName: "SessionCharged",
          data: log.data,
          topics: log.topics,
        });
        return decoded.eventName === "SessionCharged";
      } catch {
        return false;
      }
    });

    if (chargeEvent) {
      const decoded = publicClient.decodeEventLog({
        abi: VIDEO_SESSION_LOGIC_ABI,
        data: chargeEvent.data,
        topics: chargeEvent.topics,
      });
      amountCharged = (decoded as any).args.amount as bigint;
    }

    return { txHash, secondsBilled: seconds, amountCharged };
  } catch (error) {
    console.error("Error charging session:", error);

    // Check if session is closed or expired
    const errorData = (error as any).data;
    if (errorData) {
      const decoded = decodeErrorResult({
        abi: VIDEO_SESSION_LOGIC_ABI,
        data: errorData,
      });
      if (decoded) {
        console.error("Contract error:", decoded);
        // Stop charging loop if session is closed
        if (decoded.errorName === "SessionClosed" || decoded.errorName === "SessionExpired") {
          stopChargingLoop(sessionId);
        }
      }
    }

    throw error;
  }
}

/**
 * Stop an active session
 * 1. Calls closeSession on the contract
 * 2. Stops the periodic charging loop
 * 3. Revokes EIP-7702 delegation (if private key provided)
 */
export async function stopSession(params: StopSessionParams): Promise<{
  closeTxHash: Hash;
  revokeTxHash?: Hash;
}> {
  const { sessionId, userAddress, userPrivateKey } = params;

  const sessionState = activeSessions.get(sessionId);
  if (!sessionState) {
    throw new Error("Session not found");
  }

  try {
    // Close the session
    const closeTxHash = await walletClient.writeContract({
      address: sessionState.userAddress,
      abi: VIDEO_SESSION_LOGIC_ABI,
      functionName: "closeSession",
      args: [sessionId as `0x${string}`],
    });

    await publicClient.waitForTransactionReceipt({ hash: closeTxHash });

    // Stop charging loop
    stopChargingLoop(sessionId);

    // Remove from active sessions
    activeSessions.delete(sessionId);

    // Revoke delegation if private key provided
    let revokeTxHash: Hash | undefined;
    if (userPrivateKey) {
      try {
        revokeTxHash = await revokeDelegation(userAddress, userPrivateKey);
        await publicClient.waitForTransactionReceipt({ hash: revokeTxHash });
      } catch (error) {
        console.error("Error revoking delegation:", error);
        // Don't throw - session is already closed
      }
    }

    return { closeTxHash, revokeTxHash };
  } catch (error) {
    console.error("Error stopping session:", error);
    throw error;
  }
}

/**
 * Get session status from contract
 */
export async function getSessionStatus(sessionId: string): Promise<{
  user: Address;
  policyId: bigint;
  startedAt: bigint;
  chargedSeconds: bigint;
  chargedAmount: bigint;
  lastChargeAt: bigint;
  closed: boolean;
}> {
  try {
    const session = await publicClient.readContract({
      address: config.LOGIC_CONTRACT,
      abi: VIDEO_SESSION_LOGIC_ABI,
      functionName: "getSession",
      args: [sessionId as `0x${string}`],
    });

    return session as {
      user: Address;
      policyId: bigint;
      startedAt: bigint;
      chargedSeconds: bigint;
      chargedAmount: bigint;
      lastChargeAt: bigint;
      closed: boolean;
    };
  } catch (error) {
    console.error("Error getting session status:", error);
    throw error;
  }
}

/**
 * Start the periodic charging loop for a session
 */
function startChargingLoop(sessionId: string): void {
  const intervalMs = config.CHARGE_INTERVAL_SEC * 1000;

  const intervalId = setInterval(async () => {
    try {
      await chargeSession({ sessionId });
    } catch (error) {
      console.error(`Error in charging loop for session ${sessionId}:`, error);
      // Stop the loop on error
      stopChargingLoop(sessionId);
    }
  }, intervalMs);

  const sessionState = activeSessions.get(sessionId);
  if (sessionState) {
    sessionState.intervalId = intervalId;
  }
}

/**
 * Stop the periodic charging loop for a session
 */
function stopChargingLoop(sessionId: string): void {
  const sessionState = activeSessions.get(sessionId);
  if (sessionState && sessionState.intervalId) {
    clearInterval(sessionState.intervalId);
    sessionState.intervalId = undefined;
  }
}

/**
 * Revoke EIP-7702 delegation (imported from tx7702)
 */
async function revokeDelegation(userAddress: Address, userPrivateKey: Hex): Promise<Hash> {
  const { revokeDelegation: revoke } = await import("./tx7702.js");
  return revoke(userAddress, userPrivateKey);
}
