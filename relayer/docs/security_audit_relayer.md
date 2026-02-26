# Security Audit Report: TickPay Relayer

**Date:** 2026-01-24
**Target:** `tickpay-relayer` service
**Scope:** Source code review (`src/`) targeting exposed APIs, authentication, and injection risks.

## Executive Summary

The `tickpay-relayer` service currently operates with **zero authentication** on its API endpoints. This presents critical security risks, including:
1.  **Unlimited Token Minting** (Faucet Abuse).
2.  **Sensitive Information Leakage** (Active Session Enumeration).
3.  **Financial/Resource Exhaustion** (Gas Draining via Transaction Spam).

While no traditional SQL/Command Injection vulnerabilities were found (as the service uses in-memory storage and safe Viem contract bindings), the lack of access controls makes the service vulnerable to DoS and abuse.

## Critical Risks

### 1. Unauthenticated Faucet (Financial Risk)
-   **Endpoint:** `POST /api/faucet`
-   **Vulnerability:** The endpoint accepts any address and immediately mints 10 TICK tokens without any check, rate limiting, or authentication.
-   **Impact:** An attacker can drain the faucet wallet or flood the network with tokens. If deployed on a mainnet with real value, this is a direct financial loss. on testnet, it's a nuisance and gas drain.
-   **Remediation:** Remove the faucet from production or protect it with an API key / robust rate limiting (e.g., 1 request per IP per 24h).

### 2. Sensitive Information Disclosure (Privacy Risk)
-   **Endpoint:** `GET /api/sessions/active`
-   **Vulnerability:** Returns a complete list of all users currently in a billing session, including their wallet addresses (`userAddress`), policy IDs, and billing timestamps.
-   **Impact:** Allows an attacker to build a database of all active users, monitor their usage patterns, and target them for phishing or other attacks. This directly traverses the API to sensitive user data.
-   **Remediation:**
    -   Restrict this endpoint to admin-only access (require an Admin API Key).
    -   Or remove it entirely if not strictly needed by the frontend (frontend should only check *its own* session).

## High Risks

### 3. Gas Draining / Denial of Service
-   **Endpoints:** `POST /api/session/start`, `POST /api/session/charge` (internal loop)
-   **Vulnerability:**
    -   `startSession`: Anyone can submit a valid signature to start a session. While the signature verifies the *user* authorized it, an attacker could replay old signatures (if nonce management isn't perfect) or simply generate many fresh wallets to start sessions, forcing the relayer to pay gas for `openSession`.
    -   **Lack of Rate Limiting**: No rate limits exist on any endpoint.
-   **Impact:** Rapid exhaustion of the Relayer's ETH balance (for gas), rendering the service unusable for legitimate users.
-   **Remediation:**
    -   Implement Rate Limiting (e.g., using `express-rate-limit`).
    -   Require a small upfront payment or proof-of-work (though hard for a relayer).
    -   Whitelist allowed `policyId`s to prevent arbitrary policy usage.

### 4. Unauthenticated Session Controls
-   **Endpoints:** `POST /api/session/stop`
-   **Vulnerability:** Allows stopping *any* session if the `sessionId` and `userAddress` are known (which can be obtained from the `active` endpoint).
-   **Impact:** An attacker can disrupt service by stopping valid user sessions.
-   **Remediation:** Verify that the requestor is authorized to stop the session (e.g., require a signature from the user, or only allow the relayer admin to stop).

## Other Findings

-   **Injection Risks:**
    -   **SQL Injection:** None found (No SQL DB).
    -   **Command Injection:** None found.
    -   **Transaction Injection:** The `createSession` and `startSession` endpoints use structured parameters and `viem` libraries, effectively mitigating "smart contract injection" risks, provided the underlying contracts are secure.

-   **Data Persistence:**
    -   `activeSessions` is stored **in-memory**. If the relayer restarts, all active session data is lost locally. The code attempts to recover from the contract, but since EIP-7702 delegation might be temporary, this resilience strategy is fragile.

## Recommendations

1.  **Implement API Authentication:**
    -   Add an `AuthMiddleware` to `server.ts`.
    -   For client-facing routes (`create`, `start`), strict validation of inputs.
    -   For admin routes (`sessions/active`, `faucet`), require a `X-Admin-Key` header verified against an env var.

2.  **Add Rate Limiting:**
    -   Install `express-rate-limit`.
    -   Apply strict limits (e.g., 5 req/min) to `create` and `start`.

3.  **Secure the Faucet:**
    -   Disable `POST /api/faucet` in production (`if (process.env.NODE_ENV === 'production') ...`).

4.  **Hide Active Sessions:**
    -   Remove `GET /api/sessions/active` or protect it behind Admin Auth.

5.  **Validation:**
    -   Ensure `policyId` matches approved policies.
