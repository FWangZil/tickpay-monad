import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  InMemorySessionStore,
  FileSessionStore
} from "../src/server/sessionStore.js";

function sampleSession(id = "0xsession1") {
  return {
    sessionId: id,
    userAddress: "0x1000000000000000000000000000000000000001",
    policyId: 0n,
    startedAt: 100,
    lastChargeAt: 100
  };
}

test("InMemorySessionStore basic CRUD and findActiveByUser", async () => {
  const store = new InMemorySessionStore();
  await store.init();

  const s = sampleSession();
  store.set(s);
  assert.equal(store.get(s.sessionId)?.sessionId, s.sessionId);
  assert.equal(store.values().length, 1);
  assert.equal(
    store.findActiveByUser(s.userAddress, s.policyId)?.sessionId,
    s.sessionId
  );

  store.delete(s.sessionId);
  assert.equal(store.get(s.sessionId), undefined);
  assert.equal(store.values().length, 0);
});

test("FileSessionStore persists and reloads sessions", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tickpay-store-"));
  const filePath = path.join(tmpDir, "sessions.json");

  const store = new FileSessionStore({ filePath, flushDebounceMs: 1 });
  await store.init();
  store.set(sampleSession("0xabc"));
  await store.close();

  const reloaded = new FileSessionStore({ filePath, flushDebounceMs: 1 });
  await reloaded.init();
  assert.equal(reloaded.get("0xabc")?.sessionId, "0xabc");
  await reloaded.close();
});

test("FileSessionStore handles corrupted file by backing it up", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tickpay-store-corrupt-"));
  const filePath = path.join(tmpDir, "sessions.json");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "{not-json", "utf8");

  const store = new FileSessionStore({ filePath, flushDebounceMs: 1 });
  await store.init();
  assert.equal(store.values().length, 0);
  await store.close();

  const files = await fs.readdir(path.dirname(filePath));
  const hasCorruptBackup = files.some((f) => f.startsWith("sessions.json.corrupt."));
  assert.equal(hasCorruptBackup, true);
});
