# @tickpay/sdk

Reusable SDK primitives for building EIP-7702 streaming payment apps and services.

## What It Includes

- Core ABI exports (`VIDEO_SESSION_LOGIC_ABI`, `ERC20_ABI`, `NONCES_ABI`)
- EIP-712 helpers for TickPay session requests
- Monad chain adapter (`MONAD_TESTNET_CHAIN`)
- Relayer HTTP client (`createRelayerHttpClient`)
- Server session engine (`createTickPaySessionEngine`)
- Server eip7702 helpers (`@tickpay/sdk/server/eip7702`)
- Server session store (`@tickpay/sdk/server/sessionStore`)

## Install

Use local package in this monorepo:

```bash
npm install @tickpay/sdk@file:../sdk
```

For external projects, publish to npm and install by version:

```bash
npm install @tickpay/sdk
```

## Browser/Client Usage

```ts
import { createRelayerHttpClient } from "@tickpay/sdk/client/relayerHttp";

const relayer = createRelayerHttpClient("http://localhost:3001");

const createData = await relayer.createSession({
  userAddress: "0x...",
  policyId: 0,
});

const startData = await relayer.startSession({
  userAddress: "0x...",
  signature: "0x...",
  deadline: createData.deadline,
  nonce: createData.nonce,
});
```

## Server Usage (Session Engine)

`createTickPaySessionEngine` contains the TickPay open/charge/stop/status flow and charging loop.

```ts
import { createTickPaySessionEngine } from "@tickpay/sdk/server/sessionEngine";
import { buildAuthorization, revokeDelegation } from "./tx7702";
import {
  activeSessions,
  config,
  keeperAccount,
  publicClient,
  VIDEO_SESSION_LOGIC_ABI,
  walletClient,
} from "./client";

const engine = createTickPaySessionEngine({
  publicClient,
  walletClient,
  videoSessionLogicAbi: VIDEO_SESSION_LOGIC_ABI,
  config,
  keeperAddress: keeperAccount.address,
  activeSessions,
  buildAuthorization,
  revokeDelegation,
});

await engine.startSession({
  userAddress: "0x...",
  userSignature: "0x...",
});
```

For reliable session recovery across restarts, use `createSessionStore({ type: "file" })`
and call `engine.resumeActiveSessions()` on service boot.

## Extension Pattern

To support other streaming-payment systems:

1. Reuse `client/relayerHttp` and `core/eip712` if wire format is compatible.
2. Add a new server engine module (for example, `createXxxSessionEngine`).
3. Keep relayer routes thin; map request/response into engine calls.

## Run Minimal Example

```bash
cd examples/minimal-relayer
npm install
cp .env.example .env
npm run dev
```

Health check: `http://localhost:3002/health`
