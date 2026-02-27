import type { Abi, Address, Hash, Hex } from "viem";
import type { Authorization } from "../core/types";

export interface SessionState {
  sessionId: string;
  userAddress: Address;
  policyId: bigint;
  startedAt: number;
  lastChargeAt: number;
  intervalId?: NodeJS.Timeout;
}

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
  activeSessions: Map<string, SessionState>;
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
    txHash: Hash;
    policyId: bigint;
  }>;
  chargeSession(params: ChargeParams): Promise<{
    txHash: Hash;
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
}

export declare function createTickPaySessionEngine(
  deps: TickPaySessionEngineDeps
): TickPaySessionEngine;
