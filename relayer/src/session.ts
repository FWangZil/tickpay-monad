import {
  createTickPaySessionEngine,
  type ChargeParams,
  type StartSessionParams,
  type StopSessionParams
} from "@tickpay/sdk/server/sessionEngine";
import {
  config,
  keeperAccount,
  publicClient,
  VIDEO_SESSION_LOGIC_ABI,
  walletClient
} from "./client.js";
import { sessionStore } from "./store.js";
import { buildAuthorization, revokeDelegation } from "./tx7702.js";

const sessionEngine = createTickPaySessionEngine({
  publicClient,
  walletClient,
  videoSessionLogicAbi: VIDEO_SESSION_LOGIC_ABI,
  config,
  keeperAddress: keeperAccount.address,
  sessionStore,
  buildAuthorization,
  revokeDelegation
});

export const startSession = sessionEngine.startSession;
export const chargeSession = sessionEngine.chargeSession;
export const stopSession = sessionEngine.stopSession;
export const getSessionStatus = sessionEngine.getSessionStatus;
export const resumeActiveSessions = sessionEngine.resumeActiveSessions;
export const getCachedSession = sessionEngine.getCachedSession;
export const listCachedSessions = sessionEngine.listCachedSessions;
export const isSessionCharging = sessionEngine.isCharging;
export const closeSessionEngine = sessionEngine.close;

export type {
  ChargeParams,
  StartSessionParams,
  StopSessionParams
};
