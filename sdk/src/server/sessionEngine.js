import {
  decodeErrorResult,
  encodePacked,
  keccak256,
  parseEventLogs
} from "viem";

function defaultLogger() {
  return console;
}

export function createTickPaySessionEngine(deps) {
  const {
    publicClient,
    walletClient,
    videoSessionLogicAbi,
    config,
    keeperAddress,
    sessionStore,
    buildAuthorization,
    revokeDelegation,
    logger = defaultLogger(),
    maxCost = BigInt(process.env.MAX_COST || "1000000000000000000000"),
    maxSeconds = BigInt(process.env.MAX_SECONDS || "3600")
  } = deps;

  const chargingLoops = new Map();
  const chargeInFlight = new Map();
  const stoppingSessions = new Set();
  let initPromise;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForSessionClosed(address, sessionId, timeoutMs = 15_000, pollMs = 1_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      try {
        const session = await publicClient.readContract({
          address,
          abi: videoSessionLogicAbi,
          functionName: "getSession",
          args: [sessionId]
        });
        if (session?.closed) {
          return true;
        }
      } catch (error) {
        const message = error?.shortMessage ?? error?.cause?.shortMessage ?? error?.message;
        if (typeof message === "string" && message.includes("Session not found")) {
          return true;
        }
      }
      await sleep(pollMs);
    }
    return false;
  }

  function ensureInitialized() {
    if (!initPromise) {
      initPromise = sessionStore.init();
    }
    return initPromise;
  }

  async function startSession(params) {
    await ensureInitialized();

    const {
      userAddress,
      userSignature,
      userPrivateKey,
      authorizationList,
      policyId = 0n,
      deadline: providedDeadline,
      nonce: providedNonce,
      payee
    } = params;

    const existingSession = sessionStore.findActiveByUser(userAddress, policyId);
    if (existingSession) {
      startChargingLoop(existingSession.sessionId);
      return {
        sessionId: existingSession.sessionId,
        txHash: "0x",
        policyId: existingSession.policyId
      };
    }

    let nonce;
    if (providedNonce !== undefined) {
      nonce = providedNonce;
    } else {
      try {
        nonce = await publicClient.readContract({
          address: userAddress,
          abi: videoSessionLogicAbi,
          functionName: "nonces",
          args: [userAddress]
        });
      } catch {
        logger.log("Could not read nonce from user address, using 0 (first-time user)");
        nonce = 0n;
      }
    }

    const deadline = providedDeadline ?? BigInt(Math.floor(Date.now() / 1000) + 3600);
    const request = { user: userAddress, policyId, nonce, deadline };

    const policyParams = {
      keeper: keeperAddress,
      token: config.TOKEN,
      payee: payee ?? config.PAYEE,
      ratePerSecond: config.RATE_PER_SECOND,
      maxCost,
      maxSeconds,
      expiry: BigInt(Math.floor(Date.now() / 1000) + 86400 * 30)
    };

    let txHash;
    const contractArgs = [
      request,
      userSignature,
      policyParams.keeper,
      policyParams.token,
      policyParams.payee,
      policyParams.ratePerSecond,
      policyParams.maxCost,
      policyParams.maxSeconds,
      policyParams.expiry
    ];

    if (authorizationList && authorizationList.length > 0) {
      txHash = await walletClient.writeContract({
        address: userAddress,
        abi: videoSessionLogicAbi,
        functionName: "openSessionWithPolicy",
        args: contractArgs,
        authorizationList
      });
    } else if (userPrivateKey) {
      const auth = await buildAuthorization(config.LOGIC_CONTRACT, userPrivateKey);
      txHash = await walletClient.writeContract({
        address: userAddress,
        abi: videoSessionLogicAbi,
        functionName: "openSessionWithPolicy",
        args: contractArgs,
        authorizationList: [auth]
      });
    } else {
      txHash = await walletClient.writeContract({
        address: userAddress,
        abi: videoSessionLogicAbi,
        functionName: "openSessionWithPolicy",
        args: contractArgs
      });
    }

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error("openSession transaction reverted");
    }

    const userLogs = receipt.logs.filter((log) => log.address.toLowerCase() === userAddress.toLowerCase());
    const events = parseEventLogs({
      abi: videoSessionLogicAbi,
      logs: userLogs.length > 0 ? userLogs : receipt.logs,
      eventName: "SessionOpened"
    });

    let sessionId = events?.[0]?.args?.sessionId;
    if (!sessionId) {
      const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });

      let sessionCountValue = null;
      try {
        sessionCountValue = await publicClient.readContract({
          address: userAddress,
          abi: videoSessionLogicAbi,
          functionName: "sessionCount"
        });
      } catch {
        sessionCountValue = 1n;
      }

      const lastId = sessionCountValue - 1n;
      if (lastId < 0n) {
        throw new Error("SessionOpened event not found and could not determine session ID");
      }
      sessionId = keccak256(
        encodePacked(["uint256", "address", "uint256"], [lastId, userAddress, block.timestamp])
      );
    }

    const nowSec = Math.floor(Date.now() / 1000);
    sessionStore.set({
      sessionId,
      userAddress,
      policyId,
      startedAt: nowSec,
      lastChargeAt: nowSec
    });

    startChargingLoop(sessionId);
    return { sessionId, txHash, policyId };
  }

  async function chargeSession(params) {
    await ensureInitialized();
    const { sessionId, secondsToBill } = params;
    const sessionState = sessionStore.get(sessionId);
    if (!sessionState) {
      throw new Error("Session not found");
    }

    let seconds = secondsToBill;
    if (!seconds) {
      const now = Math.floor(Date.now() / 1000);
      seconds = now - sessionState.lastChargeAt;
    }

    if (seconds < 1) {
      return { txHash: "0x", secondsBilled: 0, amountCharged: 0n };
    }

    const code = await publicClient.getCode({ address: sessionState.userAddress });
    if (!code || code === "0x" || !code.startsWith("0xef0100")) {
      throw new Error("EIP-7702 delegation has ended - cannot charge");
    }

    const txHash = await walletClient.writeContract({
      address: sessionState.userAddress,
      abi: videoSessionLogicAbi,
      functionName: "charge",
      args: [sessionId, BigInt(seconds)]
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    logger.log(`[Charge] Charge tx confirmed, status: ${receipt.status}`);

    sessionStore.set({
      ...sessionState,
      lastChargeAt: Math.floor(Date.now() / 1000)
    });
    const amountCharged = BigInt(seconds || 0) * config.RATE_PER_SECOND;
    return { txHash, secondsBilled: seconds, amountCharged };
  }

  async function stopSession(params) {
    await ensureInitialized();
    const { sessionId, userAddress, userPrivateKey } = params;
    const sessionState = sessionStore.get(sessionId);
    const addressToUse = sessionState?.userAddress || userAddress;
    if (!addressToUse) {
      throw new Error("Session not found and no userAddress provided");
    }

    stoppingSessions.add(sessionId);
    stopChargingLoop(sessionId);
    const inFlightCharge = chargeInFlight.get(sessionId);
    if (inFlightCharge) {
      try {
        await inFlightCharge;
      } catch {
        // no-op: in-flight charge failures are handled in the loop path.
      }
    }

    let closeTxHash;
    let alreadyClosed = false;
    try {
      closeTxHash = await walletClient.writeContract({
        address: addressToUse,
        abi: videoSessionLogicAbi,
        functionName: "closeSession",
        args: [sessionId]
      });
      await publicClient.waitForTransactionReceipt({ hash: closeTxHash });
    } catch (error) {
      const shortMessage = error?.shortMessage ?? error?.cause?.shortMessage ?? error?.message;
      const normalizedMessage = typeof shortMessage === "string" ? shortMessage.toLowerCase() : "";
      if (normalizedMessage.includes("already closed")) {
        alreadyClosed = true;
      } else if (
        normalizedMessage.includes("higher priority") ||
        normalizedMessage.includes("nonce too low") ||
        normalizedMessage.includes("already known") ||
        normalizedMessage.includes("replacement transaction underpriced")
      ) {
        const closed = await waitForSessionClosed(addressToUse, sessionId);
        if (closed) {
          alreadyClosed = true;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    } finally {
      stoppingSessions.delete(sessionId);
    }

    stopChargingLoop(sessionId);
    sessionStore.delete(sessionId);

    let revokeTxHash;
    if (userPrivateKey) {
      try {
        revokeTxHash = await revokeDelegation(userAddress, userPrivateKey);
      } catch (error) {
        logger.error("Error revoking delegation:", error);
      }
    }

    return { closeTxHash, revokeTxHash, alreadyClosed };
  }

  async function getSessionStatus(sessionId, userAddress) {
    await ensureInitialized();
    const cachedSession = sessionStore.get(sessionId);
    const addressToQuery = userAddress || cachedSession?.userAddress;
    if (!addressToQuery) {
      return null;
    }

    try {
      const session = await publicClient.readContract({
        address: addressToQuery,
        abi: videoSessionLogicAbi,
        functionName: "getSession",
        args: [sessionId]
      });
      return session;
    } catch (error) {
      const message = error?.shortMessage ?? error?.cause?.shortMessage ?? error?.message;
      if (typeof message === "string" && message.includes("Session not found")) {
        return null;
      }
      throw error;
    }
  }

  async function resumeActiveSessions() {
    await ensureInitialized();
    for (const session of sessionStore.values()) {
      startChargingLoop(session.sessionId);
    }
  }

  function getCachedSession(sessionId) {
    return sessionStore.get(sessionId);
  }

  function listCachedSessions() {
    return sessionStore.values();
  }

  function isCharging(sessionId) {
    return chargingLoops.has(sessionId);
  }

  function startChargingLoop(sessionId) {
    if (chargingLoops.has(sessionId)) {
      return;
    }
    const intervalMs = config.CHARGE_INTERVAL_SEC * 1000;
    const intervalId = setInterval(async () => {
      if (stoppingSessions.has(sessionId)) {
        return;
      }
      if (chargeInFlight.has(sessionId)) {
        return;
      }
      const chargePromise = (async () => {
        try {
          const result = await chargeSession({ sessionId });
          logger.log(`[Charge] Charged ${sessionId}`, {
            txHash: result.txHash,
            secondsBilled: result.secondsBilled,
            amountCharged: result.amountCharged.toString()
          });
        } catch (error) {
          logger.error(`[Charge] Loop error for ${sessionId}:`, error);
          const errorData = error?.data;
          if (errorData) {
            try {
              const decoded = decodeErrorResult({ abi: videoSessionLogicAbi, data: errorData });
              if (decoded?.errorName === "SessionClosed" || decoded?.errorName === "SessionExpired") {
                sessionStore.delete(sessionId);
              }
            } catch {
              // no-op
            }
          }
          stopChargingLoop(sessionId);
        } finally {
          if (chargeInFlight.get(sessionId) === chargePromise) {
            chargeInFlight.delete(sessionId);
          }
        }
      })();

      chargeInFlight.set(sessionId, chargePromise);
      try {
        await chargePromise;
      } catch {
        // no-op: already handled above
      }
    }, intervalMs);

    chargingLoops.set(sessionId, intervalId);
  }

  function stopChargingLoop(sessionId) {
    const intervalId = chargingLoops.get(sessionId);
    if (intervalId) {
      clearInterval(intervalId);
      chargingLoops.delete(sessionId);
    }
  }

  async function close() {
    for (const sessionId of chargingLoops.keys()) {
      stopChargingLoop(sessionId);
    }
    await sessionStore.close();
  }

  return {
    startSession,
    chargeSession,
    stopSession,
    getSessionStatus,
    resumeActiveSessions,
    getCachedSession,
    listCachedSessions,
    isCharging,
    close
  };
}
