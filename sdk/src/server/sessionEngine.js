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
    activeSessions,
    buildAuthorization,
    revokeDelegation,
    logger = defaultLogger(),
    maxCost = BigInt(process.env.MAX_COST || "1000000000000000000000"),
    maxSeconds = BigInt(process.env.MAX_SECONDS || "3600")
  } = deps;

  async function startSession(params) {
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

    logger.log("[Session] Opening session with policy:", {
      userAddress,
      policyId: policyId.toString(),
      keeper: policyParams.keeper,
      token: policyParams.token,
      payee: policyParams.payee,
      ratePerSecond: policyParams.ratePerSecond.toString()
    });

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
      logger.log("[EIP-7702] Using provided authorizationList:", JSON.stringify(authorizationList, null, 2));
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

    const codeAfterTx = await publicClient.getCode({ address: userAddress });
    logger.log("[EIP-7702] Code at user address after tx:", codeAfterTx);
    if (codeAfterTx && codeAfterTx.startsWith("0xef0100")) {
      logger.log("[EIP-7702] Delegation is active:", `0x${codeAfterTx.slice(8)}`);
    } else {
      logger.error("[EIP-7702] Delegation is not active:", codeAfterTx);
    }

    logger.log(
      "Transaction receipt logs:",
      JSON.stringify(receipt.logs, (_, value) => (typeof value === "bigint" ? value.toString() : value), 2)
    );

    const userLogs = receipt.logs.filter((log) => log.address.toLowerCase() === userAddress.toLowerCase());
    const events = parseEventLogs({
      abi: videoSessionLogicAbi,
      logs: userLogs.length > 0 ? userLogs : receipt.logs,
      eventName: "SessionOpened"
    });

    let sessionId = events?.[0]?.args?.sessionId;
    if (!sessionId) {
      logger.log("SessionOpened not found, calculating fallback sessionId...");
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
    activeSessions.set(sessionId, {
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
    const { sessionId, secondsToBill } = params;
    const sessionState = activeSessions.get(sessionId);
    if (!sessionState) {
      throw new Error("Session not found");
    }

    let seconds = secondsToBill;
    if (!seconds) {
      const now = Math.floor(Date.now() / 1000);
      seconds = now - sessionState.lastChargeAt;
    }

    if (seconds < 1) {
      logger.log(`[Charge] Skipping charge for ${sessionId}: <1 second elapsed`);
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

    sessionState.lastChargeAt = Math.floor(Date.now() / 1000);
    const amountCharged = BigInt(seconds || 0) * config.RATE_PER_SECOND;
    return { txHash, secondsBilled: seconds, amountCharged };
  }

  async function stopSession(params) {
    const { sessionId, userAddress, userPrivateKey } = params;
    const sessionState = activeSessions.get(sessionId);
    const addressToUse = sessionState?.userAddress || userAddress;
    if (!addressToUse) {
      throw new Error("Session not found and no userAddress provided");
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
      if (typeof shortMessage === "string" && shortMessage.toLowerCase().includes("already closed")) {
        alreadyClosed = true;
      } else {
        throw error;
      }
    }

    if (sessionState) {
      stopChargingLoop(sessionId);
      activeSessions.delete(sessionId);
    }

    let revokeTxHash;
    if (userPrivateKey) {
      try {
        revokeTxHash = await revokeDelegation(userAddress, userPrivateKey);
        if (typeof revokeTxHash === "string" && revokeTxHash.length === 66) {
          await publicClient.waitForTransactionReceipt({ hash: revokeTxHash });
        } else {
          revokeTxHash = undefined;
        }
      } catch (error) {
        logger.error("Error revoking delegation:", error);
      }
    }

    return { closeTxHash, revokeTxHash, alreadyClosed };
  }

  async function getSessionStatus(sessionId, userAddress) {
    const activeSession = activeSessions.get(sessionId);
    const addressToQuery = userAddress || activeSession?.userAddress;
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

  function startChargingLoop(sessionId) {
    const intervalMs = config.CHARGE_INTERVAL_SEC * 1000;
    const intervalId = setInterval(async () => {
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
              stopChargingLoop(sessionId);
            }
          } catch {
            // no-op
          }
        } else {
          stopChargingLoop(sessionId);
        }
      }
    }, intervalMs);

    const sessionState = activeSessions.get(sessionId);
    if (sessionState) {
      sessionState.intervalId = intervalId;
    }
  }

  function stopChargingLoop(sessionId) {
    const sessionState = activeSessions.get(sessionId);
    if (sessionState && sessionState.intervalId) {
      clearInterval(sessionState.intervalId);
      sessionState.intervalId = undefined;
    }
  }

  return {
    startSession,
    chargeSession,
    stopSession,
    getSessionStatus
  };
}
