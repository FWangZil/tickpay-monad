import type { AddressLike, Authorization } from "../core/types";

export interface CreateSessionInput {
  userAddress: AddressLike;
  policyId?: number | string | bigint;
}

export interface CreateSessionResponse {
  userAddress: AddressLike;
  policyId: string;
  nonce: string;
  deadline: string;
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: AddressLike;
  };
  types: {
    SessionRequest: Array<{ name: string; type: string }>;
  };
  message: {
    user: AddressLike;
    policyId: string;
    nonce: string;
    deadline: string;
  };
}

export interface StartSessionInput {
  userAddress: AddressLike;
  signature: `0x${string}`;
  userPrivateKey?: `0x${string}`;
  policyId?: number | string | bigint;
  authorizationList?: Authorization[];
  deadline?: number | string | bigint;
  nonce?: number | string | bigint;
  payee?: AddressLike;
}

export interface StartSessionResponse {
  success: boolean;
  sessionId: string;
  txHash: `0x${string}`;
  policyId: string;
  message: string;
}

export interface StopSessionInput {
  sessionId: string;
  userAddress: AddressLike;
  userPrivateKey?: `0x${string}`;
}

export interface StopSessionResponse {
  success: boolean;
  closeTxHash: string | null;
  revokeTxHash?: string;
  alreadyClosed?: boolean;
  message: string;
}

export interface SessionStatusResponse {
  success: boolean;
  sessionId: string;
  user: AddressLike;
  policyId: string;
  startedAt: string;
  chargedSeconds: string;
  chargedAmount: string;
  lastChargeAt: string;
  closed: boolean;
  activelyCharging?: boolean;
}

export interface ActiveSessionsResponse {
  success: boolean;
  count: number;
  sessions: Array<{
    sessionId: string;
    userAddress: AddressLike;
    policyId: string;
    startedAt: number;
    lastChargeAt: number;
    activelyCharging: boolean;
  }>;
}

export interface FaucetInput {
  address: AddressLike;
}

export interface FaucetResponse {
  success: boolean;
  txHash: `0x${string}`;
  amount: string;
  token: AddressLike;
  balanceBefore: string | null;
  balanceAfter: string | null;
  warning?: string | null;
}

export interface RelayerHttpClient {
  createSession(input: CreateSessionInput): Promise<CreateSessionResponse>;
  startSession(input: StartSessionInput): Promise<StartSessionResponse>;
  stopSession(input: StopSessionInput): Promise<StopSessionResponse>;
  getSessionStatus(sessionId: string): Promise<SessionStatusResponse>;
  getActiveSessions(): Promise<ActiveSessionsResponse>;
  faucet(input: FaucetInput): Promise<FaucetResponse>;
}

export declare function createRelayerHttpClient(
  baseUrl: string,
  options?: { fetchImpl?: typeof fetch }
): RelayerHttpClient;
