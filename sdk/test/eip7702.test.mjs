import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthorization,
  revokeDelegation,
  ZERO_ADDRESS
} from "../src/server/eip7702.js";

const TEST_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const TEST_USER = "0x19E7E376E7C213B7E7e7e46cc70A5Dd086DAff2A";
const TEST_KEEPER = "0x1000000000000000000000000000000000000001";

test("buildAuthorization returns normalized authorization fields", async () => {
  const auth = await buildAuthorization({
    publicClient: {
      async getTransactionCount() {
        return 7n;
      }
    },
    userPrivateKey: TEST_PRIVATE_KEY,
    delegateAddress: "0x2000000000000000000000000000000000000002",
    chainId: 10143
  });

  assert.equal(auth.address, "0x2000000000000000000000000000000000000002");
  assert.equal(auth.chainId, 10143);
  assert.equal(auth.nonce, 7);
  assert.ok(typeof auth.r === "string" && auth.r.startsWith("0x"));
  assert.ok(typeof auth.s === "string" && auth.s.startsWith("0x"));
});

test("revokeDelegation sends type-4 tx with zero-address authorization", async () => {
  let sendArgs;
  const txHash = await revokeDelegation({
    publicClient: {
      async getTransactionCount() {
        return 9n;
      },
      async waitForTransactionReceipt() {
        return { status: "success" };
      },
      async getCode() {
        return "0x";
      }
    },
    walletClient: {
      async sendTransaction(args) {
        sendArgs = args;
        return "0x" + "ab".repeat(32);
      }
    },
    userAddress: TEST_USER,
    userPrivateKey: TEST_PRIVATE_KEY,
    chainId: 10143,
    keeperAddress: TEST_KEEPER
  });

  assert.equal(txHash.length, 66);
  assert.equal(sendArgs.to, TEST_KEEPER);
  assert.equal(sendArgs.data, "0x");
  assert.equal(sendArgs.authorizationList.length, 1);
  assert.equal(sendArgs.authorizationList[0].address, ZERO_ADDRESS);
});

test("revokeDelegation throws when code still exists after revoke", async () => {
  await assert.rejects(
    () =>
      revokeDelegation({
        publicClient: {
          async getTransactionCount() {
            return 1n;
          },
          async waitForTransactionReceipt() {
            return { status: "success" };
          },
          async getCode() {
            return "0xef01000000000000000000000000000000000000000000";
          }
        },
        walletClient: {
          async sendTransaction() {
            return "0x" + "cd".repeat(32);
          }
        },
        userAddress: TEST_USER,
        userPrivateKey: TEST_PRIVATE_KEY,
        chainId: 10143,
        keeperAddress: TEST_KEEPER
      }),
    /delegation revoke verification failed/
  );
});
