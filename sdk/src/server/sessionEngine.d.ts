import type { Abi, Address, Hash, Hex } from "viem";
import type { Authorization } from "../core/types";
import type { SessionStore, SessionStoreSessionState } from "./sessionStore";

export interface TickPaySessionConfig {
  LOGIC_CONTRACT: Address;
  TOKEN: Address;
  PAYEE: Address;
  RATE_PER_SECOND: bigint;
  CHARGE_INTERVAL_SEC: number;
}

export interface TickPaySessionEngineDeps {
  publicClient: any;
  walletClient: any;
  videoSessionLogicAbi: Abi;
  config: TickPaySessionConfig;
  keeperAddress: Address;
  sessionStore: SessionStore;
  buildAuthorization: (delegateContract: Address, userPrivateKey: Hex) => Promise<Authorization>;
  revokeDelegation: (userAddress: Address, userPrivateKey: Hex) => Promise<Hash>;
  logger?: Pick<Console, "log" | "error" | "warn" | "info">;
  maxCost?: bigint;
  maxSeconds?: bigint;
}

export interface StartSessionParams {
  userAddress: Address;
  userSignature: Hex;
  userPrivateKey?: Hex;
  authorizationList?: Authorization[];
  policyId?: bigint;
  deadline?: bigint;
  nonce?: bigint;
  payee?: Address;
}

export interface ChargeParams {
  sessionId: string;
  secondsToBill?: number;
}

export interface StopSessionParams {
  sessionId: string;
  userAddress: Address;
  userPrivateKey?: Hex;
}

export interface TickPaySessionEngine {
  startSession(params: StartSessionParams): Promise<{
    sessionId: string;
    txHash: Hash | "0x";
    policyId: bigint;
  }>;
  chargeSession(params: ChargeParams): Promise<{
    txHash: Hash | "0x";
    secondsBilled: number;
    amountCharged: bigint;
  }>;
  stopSession(params: StopSessionParams): Promise<{
    closeTxHash?: Hash;
    revokeTxHash?: Hash;
    alreadyClosed?: boolean;
  }>;
  getSessionStatus(sessionId: string, userAddress?: Address): Promise<{
    user: Address;
    policyId: bigint;
    startedAt: bigint;
    chargedSeconds: bigint;
    chargedAmount: bigint;
    lastChargeAt: bigint;
    closed: boolean;
  } | null>;
  resumeActiveSessions(): Promise<void>;
  getCachedSession(sessionId: string): SessionStoreSessionState | undefined;
  listCachedSessions(): SessionStoreSessionState[];
  isCharging(sessionId: string): boolean;
  close(): Promise<void>;
}

export declare function createTickPaySessionEngine(
  deps: TickPaySessionEngineDeps
): TickPaySessionEngine;
