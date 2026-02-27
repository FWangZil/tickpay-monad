import fs from "node:fs/promises";
import path from "node:path";

function normalizeSessionState(session) {
  return {
    sessionId: session.sessionId,
    userAddress: session.userAddress,
    policyId: typeof session.policyId === "bigint" ? session.policyId : BigInt(session.policyId),
    startedAt: Number(session.startedAt),
    lastChargeAt: Number(session.lastChargeAt),
  };
}

function defaultFilePath() {
  return path.join(process.cwd(), ".tickpay", "sessions.json");
}

export class InMemorySessionStore {
  constructor(initialSessions = []) {
    this.sessions = new Map();
    for (const session of initialSessions) {
      const normalized = normalizeSessionState(session);
      this.sessions.set(normalized.sessionId, normalized);
    }
  }

  async init() {}

  get(sessionId) {
    return this.sessions.get(sessionId);
  }

  set(sessionState) {
    const normalized = normalizeSessionState(sessionState);
    this.sessions.set(normalized.sessionId, normalized);
  }

  delete(sessionId) {
    this.sessions.delete(sessionId);
  }

  values() {
    return Array.from(this.sessions.values());
  }

  findActiveByUser(userAddress, policyId) {
    for (const session of this.sessions.values()) {
      if (session.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
        continue;
      }
      if (policyId !== undefined && session.policyId !== policyId) {
        continue;
      }
      return session;
    }
    return undefined;
  }

  async close() {}
}

export class FileSessionStore extends InMemorySessionStore {
  constructor({
    filePath = defaultFilePath(),
    flushDebounceMs = 500,
    logger = console,
  } = {}) {
    super();
    this.filePath = filePath;
    this.flushDebounceMs = flushDebounceMs;
    this.logger = logger;
    this.flushTimer = undefined;
    this.flushInFlight = undefined;
    this.initialized = false;
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
      this.sessions = new Map(
        sessions.map((session) => {
          const normalized = normalizeSessionState(session);
          return [normalized.sessionId, normalized];
        })
      );
    } catch (error) {
      if (error && error.code === "ENOENT") {
        this.sessions = new Map();
        await this.#flushNow();
      } else {
        const corruptPath = `${this.filePath}.corrupt.${Date.now()}`;
        try {
          await fs.rename(this.filePath, corruptPath);
          this.logger.warn(
            `[SessionStore] Corrupt session store moved to ${corruptPath}. Starting with empty state.`
          );
        } catch (renameError) {
          this.logger.warn("[SessionStore] Failed to move corrupt store file:", renameError);
        }
        this.sessions = new Map();
        await this.#flushNow();
      }
    }

    this.initialized = true;
  }

  set(sessionState) {
    super.set(sessionState);
    this.#scheduleFlush();
  }

  delete(sessionId) {
    super.delete(sessionId);
    this.#scheduleFlush();
  }

  async close() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    await this.#flushNow();
  }

  #scheduleFlush() {
    if (!this.initialized) {
      return;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.#flushNow().catch((error) => {
        this.logger.error("[SessionStore] Failed to flush sessions:", error);
      });
    }, this.flushDebounceMs);
  }

  async #flushNow() {
    if (this.flushInFlight) {
      return this.flushInFlight;
    }

    this.flushInFlight = (async () => {
      const tmpPath = `${this.filePath}.tmp`;
      const payload = {
        sessions: this.values().map((session) => ({
          sessionId: session.sessionId,
          userAddress: session.userAddress,
          policyId: session.policyId.toString(),
          startedAt: session.startedAt,
          lastChargeAt: session.lastChargeAt,
        })),
      };
      await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf8");
      await fs.rename(tmpPath, this.filePath);
    })();

    try {
      await this.flushInFlight;
    } finally {
      this.flushInFlight = undefined;
    }
  }
}

export function createSessionStore({
  type = "file",
  filePath = defaultFilePath(),
  flushDebounceMs = 500,
  logger = console,
} = {}) {
  if (type === "memory") {
    return new InMemorySessionStore();
  }
  return new FileSessionStore({
    filePath,
    flushDebounceMs,
    logger,
  });
}
