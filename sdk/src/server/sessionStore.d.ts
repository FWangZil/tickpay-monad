import type { Address } from "viem";

export interface SessionStoreSessionState {
  sessionId: string;
  userAddress: Address;
  policyId: bigint;
  startedAt: number;
  lastChargeAt: number;
}

export interface SessionStore {
  init(): Promise<void>;
  get(sessionId: string): SessionStoreSessionState | undefined;
  set(sessionState: SessionStoreSessionState): void;
  delete(sessionId: string): void;
  values(): SessionStoreSessionState[];
  findActiveByUser(
    userAddress: Address,
    policyId?: bigint
  ): SessionStoreSessionState | undefined;
  close(): Promise<void>;
}

export interface FileSessionStoreOptions {
  filePath?: string;
  flushDebounceMs?: number;
  logger?: Pick<Console, "log" | "warn" | "error" | "info">;
}

export declare class InMemorySessionStore implements SessionStore {
  constructor(initialSessions?: SessionStoreSessionState[]);
  init(): Promise<void>;
  get(sessionId: string): SessionStoreSessionState | undefined;
  set(sessionState: SessionStoreSessionState): void;
  delete(sessionId: string): void;
  values(): SessionStoreSessionState[];
  findActiveByUser(
    userAddress: Address,
    policyId?: bigint
  ): SessionStoreSessionState | undefined;
  close(): Promise<void>;
}

export declare class FileSessionStore extends InMemorySessionStore {
  constructor(options?: FileSessionStoreOptions);
  init(): Promise<void>;
  set(sessionState: SessionStoreSessionState): void;
  delete(sessionId: string): void;
  close(): Promise<void>;
}

export interface CreateSessionStoreOptions extends FileSessionStoreOptions {
  type?: "file" | "memory";
}

export declare function createSessionStore(
  options?: CreateSessionStoreOptions
): SessionStore;
