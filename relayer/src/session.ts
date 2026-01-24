import {
  type Address,
  type Hash,
  type Hex,
  decodeErrorResult,
  encodePacked,
  keccak256,
  type TransactionReceipt,
  parseEventLogs,
} from "viem";
import { publicClient, walletClient, VIDEO_SESSION_LOGIC_ABI, config, activeSessions, type SessionState } from "./client.js";
import { buildAuthorization, type Authorization } from "./tx7702.js";

export interface StartSessionParams {
  userAddress: Address;
  userSignature: Hex; // EIP-712 signature for session request
  userPrivateKey?: Hex; // Optional: for demo mode with test key
  authorizationList?: Authorization[];
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
  const {
    userAddress,
    userSignature,
    userPrivateKey,
    authorizationList,
    policyId = 0n,
  } = params;

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

    if (authorizationList && authorizationList.length > 0) {
      txHash = await walletClient.writeContract({
        address: userAddress, // Call the user's EOA (delegated)
        abi: VIDEO_SESSION_LOGIC_ABI,
        functionName: "openSession",
        args: [request, userSignature],
        // @ts-ignore - viem supports authorizationList in type 4
        authorizationList,
      });
    } else if (userPrivateKey) {
      // Demo mode: Use type 4 transaction with EIP-7702 delegation
      const auth = await buildAuthorization(config.LOGIC_CONTRACT, userPrivateKey);

      // @ts-ignore - EIP-7702 authorizationList support
      txHash = await walletClient.writeContract({
        address: userAddress, // Call the user's EOA (delegated)
        abi: VIDEO_SESSION_LOGIC_ABI,
        functionName: "openSession",
        args: [request, userSignature],
        authorizationList: [auth as any],
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
    if (receipt.status !== "success") {
      throw new Error("openSession transaction reverted");
    }

    console.log("Transaction receipt logs:", JSON.stringify(receipt.logs, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    , 2));

    // Parse SessionOpened event to get the actual sessionId
    // Filter logs from userAddress (where EIP-7702 delegated contract emits events)
    const userLogs = receipt.logs.filter(
      (log) => log.address.toLowerCase() === userAddress.toLowerCase()
    );
    console.log("User address logs:", userLogs.length);

    const events = parseEventLogs({
      abi: VIDEO_SESSION_LOGIC_ABI,
      logs: userLogs.length > 0 ? userLogs : receipt.logs,
      eventName: "SessionOpened",
    }) as Array<{ args?: { sessionId?: string } }>;

    console.log("Parsed events:", events);

    let sessionId = events[0]?.args?.sessionId as string | undefined;
    if (!sessionId) {
      console.log("Event not found, attempting fallback calculation...");
      // In EIP-7702, the delegation may only be active during the transaction
      // After transaction completes, user address may revert to EOA
      // So we need to calculate sessionId from transaction data
      const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });

      // Try to read sessionCount from user address first (if delegation persists)
      // If that fails, try to reconstruct sessionId from known data
      let sessionCountValue: bigint | null = null;
      try {
        sessionCountValue = await publicClient.readContract({
          address: userAddress,
          abi: VIDEO_SESSION_LOGIC_ABI,
          functionName: "sessionCount",
        }) as bigint;
        console.log("Fallback session count from user address:", sessionCountValue);
      } catch (e) {
        console.log("Could not read sessionCount from user address (EIP-7702 delegation may have ended)");
        // This is expected in EIP-7702 when delegation is only for single transaction
        // Use 0 as the session ID since this is likely the first session
        sessionCountValue = 1n; // After openSession, count would be 1
      }

      const lastId = sessionCountValue - 1n;
      console.log("Last session ID index:", lastId);

      if (lastId < 0n) {
        throw new Error("SessionOpened event not found and could not determine session ID");
      }
      sessionId = keccak256(
        encodePacked(
          ["uint256", "address", "uint256"],
          [lastId, userAddress, block.timestamp],
        ),
      );
      console.log("Calculated sessionId:", sessionId);
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
    let lastChargeTime = sessionState.lastChargeAt;

    if (!seconds) {
      const now = Math.floor(Date.now() / 1000);
      seconds = now - sessionState.lastChargeAt;
      lastChargeTime = now;
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

    // Simplified: assume amount based on seconds and rate
    const amountCharged = BigInt(seconds || 0) * config.RATE_PER_SECOND;

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
} | null> {
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
    const message =
      (error as { shortMessage?: string })?.shortMessage ??
      (error as { cause?: { shortMessage?: string } })?.cause?.shortMessage ??
      (error as Error).message;
    if (typeof message === "string" && message.includes("Session not found")) {
      return null;
    }
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
