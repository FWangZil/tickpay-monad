import test from "node:test";
import assert from "node:assert/strict";
import { createTickPaySessionEngine } from "../src/server/sessionEngine.js";
import { InMemorySessionStore } from "../src/server/sessionStore.js";

const SESSION_ID = "0x" + "11".repeat(32);
const USER = "0x1000000000000000000000000000000000000001";
const MINIMAL_ABI = [
  {
    type: "event",
    name: "SessionOpened",
    inputs: [
      { name: "sessionId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "policyId", type: "uint256", indexed: false }
    ]
  }
];

function createDeps() {
  const store = new InMemorySessionStore();
  let closeCallCount = 0;
  let chargeCallCount = 0;

  const publicClient = {
    async readContract({ functionName }) {
      if (functionName === "sessionCount") return 1n;
      if (functionName === "getSession") {
        return {
          user: USER,
          policyId: 0n,
          startedAt: 1n,
          chargedSeconds: 0n,
          chargedAmount: 0n,
          lastChargeAt: 1n,
          closed: false
        };
      }
      return 0n;
    },
    async waitForTransactionReceipt() {
      return { status: "success", logs: [] };
    },
    async getBlock() {
      return { timestamp: 1000n };
    },
    async getCode() {
      return "0xef01000000000000000000000000000000000000000000";
    }
  };

  const walletClient = {
    async writeContract({ functionName }) {
      if (functionName === "closeSession") {
        closeCallCount += 1;
      }
      if (functionName === "charge") {
        chargeCallCount += 1;
      }
      return "0x" + "22".repeat(32);
    }
  };

  const engine = createTickPaySessionEngine({
    publicClient,
    walletClient,
    videoSessionLogicAbi: MINIMAL_ABI,
    config: {
      LOGIC_CONTRACT: "0x2000000000000000000000000000000000000002",
      TOKEN: "0x3000000000000000000000000000000000000003",
      PAYEE: "0x4000000000000000000000000000000000000004",
      RATE_PER_SECOND: 1n,
      CHARGE_INTERVAL_SEC: 999999
    },
    keeperAddress: "0x5000000000000000000000000000000000000005",
    sessionStore: store,
    async buildAuthorization() {
      return {
        address: "0x2000000000000000000000000000000000000002",
        chainId: 10143,
        nonce: 1,
        r: "0x" + "01".repeat(32),
        s: "0x" + "02".repeat(32),
        yParity: 0
      };
    },
    async revokeDelegation() {
      return "0x" + "33".repeat(32);
    },
    logger: {
      log() {},
      warn() {},
      error() {},
      info() {}
    }
  });

  return { engine, store, closeCallCountRef: () => closeCallCount, chargeCallCountRef: () => chargeCallCount };
}

test("session engine start/stop lifecycle with store", async () => {
  const { engine, store, closeCallCountRef } = createDeps();

  const start = await engine.startSession({
    userAddress: USER,
    userSignature: "0x" + "44".repeat(65),
    policyId: 0n,
    nonce: 0n,
    deadline: 9999999999n,
    authorizationList: [
      {
        address: "0x2000000000000000000000000000000000000002",
        chainId: 10143,
        nonce: 1,
        r: "0x" + "01".repeat(32),
        s: "0x" + "02".repeat(32),
        yParity: 0
      }
    ]
  });

  assert.equal(typeof start.sessionId, "string");
  assert.equal(store.values().length, 1);
  assert.equal(engine.isCharging(start.sessionId), true);

  const stop = await engine.stopSession({
    sessionId: start.sessionId,
    userAddress: USER,
    userPrivateKey: "0x" + "11".repeat(32)
  });

  assert.equal(closeCallCountRef(), 1);
  assert.equal(store.values().length, 0);
  assert.equal(engine.isCharging(start.sessionId), false);
  assert.equal(typeof stop.revokeTxHash, "string");

  await engine.close();
});

test("session engine start is idempotent for same user/policy", async () => {
  const { engine } = createDeps();
  const authorizationList = [
    {
      address: "0x2000000000000000000000000000000000000002",
      chainId: 10143,
      nonce: 1,
      r: "0x" + "01".repeat(32),
      s: "0x" + "02".repeat(32),
      yParity: 0
    }
  ];

  const first = await engine.startSession({
    userAddress: USER,
    userSignature: "0x" + "44".repeat(65),
    policyId: 0n,
    nonce: 0n,
    deadline: 9999999999n,
    authorizationList
  });

  const second = await engine.startSession({
    userAddress: USER,
    userSignature: "0x" + "55".repeat(65),
    policyId: 0n,
    nonce: 1n,
    deadline: 9999999999n,
    authorizationList
  });

  assert.equal(first.sessionId, second.sessionId);
  assert.equal(second.txHash, "0x");
  await engine.close();
});

test("resumeActiveSessions restores loops from persisted store state", async () => {
  const store = new InMemorySessionStore([
    {
      sessionId: SESSION_ID,
      userAddress: USER,
      policyId: 0n,
      startedAt: 10,
      lastChargeAt: 10
    }
  ]);

  const engine = createTickPaySessionEngine({
    publicClient: {
      async readContract() {
        return 0n;
      },
      async waitForTransactionReceipt() {
        return { status: "success", logs: [] };
      },
      async getBlock() {
        return { timestamp: 1000n };
      },
      async getCode() {
        return "0xef01000000000000000000000000000000000000000000";
      }
    },
    walletClient: {
      async writeContract() {
        return "0x" + "77".repeat(32);
      }
    },
    videoSessionLogicAbi: MINIMAL_ABI,
    config: {
      LOGIC_CONTRACT: "0x2000000000000000000000000000000000000002",
      TOKEN: "0x3000000000000000000000000000000000000003",
      PAYEE: "0x4000000000000000000000000000000000000004",
      RATE_PER_SECOND: 1n,
      CHARGE_INTERVAL_SEC: 999999
    },
    keeperAddress: "0x5000000000000000000000000000000000000005",
    sessionStore: store,
    async buildAuthorization() {
      throw new Error("not used");
    },
    async revokeDelegation() {
      throw new Error("not used");
    },
    logger: {
      log() {},
      warn() {},
      error() {},
      info() {}
    }
  });

  await engine.resumeActiveSessions();
  assert.equal(engine.isCharging(SESSION_ID), true);
  await engine.close();
});
