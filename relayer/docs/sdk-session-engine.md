# Relayer Integration with `@tickpay/sdk` Session Engine

This relayer now uses `createTickPaySessionEngine` from `@tickpay/sdk/server/sessionEngine`.

## Current Wiring

- Engine implementation: `sdk/src/server/sessionEngine.js`
- Relayer composition root: `relayer/src/session.ts`
- API handlers stay unchanged and call exported functions from `relayer/src/session.ts`
- Store wiring: `relayer/src/store.ts` (`SESSION_STORE=file|memory`, default `file`)
- Startup recovery: `relayer/src/main.ts` calls `resumeActiveSessions()`

## Why This Matters

- Business orchestration (`start/charge/stop/status`) is now reusable outside this relayer.
- The relayer is mostly dependency wiring plus HTTP transport.
- New streaming systems can be added by introducing a new engine implementation without changing API shape.

## Minimal Integration Contract

The engine requires these injected dependencies:

- `publicClient`
- `walletClient`
- `videoSessionLogicAbi`
- `config`
- `keeperAddress`
- `activeSessions`
- `sessionStore`
- `buildAuthorization`
- `revokeDelegation`

## Migration Checklist for Another Service

1. Install `@tickpay/sdk`.
2. Provide the required clients/config and auth hooks.
3. Construct `createTickPaySessionEngine(...)`.
4. Expose `startSession`, `chargeSession`, `stopSession`, `getSessionStatus`.
5. Keep HTTP handlers/queue workers as thin adapters.
