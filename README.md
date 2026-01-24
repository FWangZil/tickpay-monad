# TickPay - Per-Second Video Billing on Monad

A per-second video billing system using EIP-7702 account abstraction on Monad blockchain. Users temporarily delegate their account to a smart contract during video playback, enabling automated billing by a relayer, with immediate revocation after viewing.

## Features

- **EIP-7702 Account Abstraction**: Temporary delegation of user's EOA to billing contract
- **Per-Second Billing**: Automatic charges every 10 seconds during video playback
- **One-Click Start/Stop**: Instant delegation and revocation via relayer
- **Keeper-Only Charging**: Only authorized relayer can process charges
- **ERC20 Payments**: No native MON transfers (avoids 10 MON reserve rule)
- **Type 4 Transactions**: Full EIP-7702 authorization list support

## Architecture

```
┌─────────────┐         ┌─────────────┐         ┌──────────────────┐
│   Web UI    │◄────────┤   Relayer   │◄────────┤  Monad Blockchain │
│  (Next.js)  │         │  (Node.js)  │         │  (EIP-7702)      │
└─────────────┘         └─────────────┘         └──────────────────┘
      │                       │                          │
      │                       │                          │
   Video Player        Authorization List         VideoSessionLogic
   + Session API       + Type 4 Transactions     + ERC20 Token
```

## Project Structure

```
tickpay/
├── contracts/              # Foundry smart contracts
│   ├── src/
│   │   ├── VideoSessionLogic.sol    # Main billing logic
│   │   ├── MockERC20.sol            # Test ERC20 token
│   │   └── interfaces/
│   │       └── IERC20.sol
│   ├── test/
│   │   └── VideoSessionLogic.t.sol  # Test suite
│   └── script/
│       └── DeployVideoSession.s.sol # Deployment script
├── relayer/                # Node.js + Viem relayer service
│   └── src/
│       ├── client.ts                   # Viem client setup
│       ├── tx7702.ts                   # EIP-7702 authorization builder
│       ├── session.ts                  # Session management
│       ├── eip712.ts                   # EIP-712 signature utilities
│       ├── server.ts                   # Express API server
│       ├── main.ts                     # Entry point
│       └── api/
│           ├── create.ts               # Session creation endpoint
│           ├── start.ts                # Start session endpoint
│           ├── stop.ts                 # Stop session endpoint
│           └── status.ts               # Session status endpoint
├── web/                    # Next.js frontend
│   └── app/
│       ├── page.tsx                    # Video player + billing UI
│       ├── layout.tsx                  # Root layout
│       ├── globals.css                 # Styles
│       └── api/session/                # API routes
│   └── lib/
│       ├── viem.ts                     # Viem client configuration
│       ├── eip712.ts                   # EIP-712 domain + types
│       └── types.ts                    # TypeScript definitions
└── README.md
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Blockchain | Monad (Chain ID 143) |
| Smart Contracts | Solidity ^0.8.13, Foundry |
| Relayer | Node.js, TypeScript, Viem, Express |
| Frontend | Next.js 15, React, Tailwind CSS, Viem |
| Account Abstraction | EIP-7702 |

## Quick Start

### Prerequisites

- Node.js 20+
- Foundry (`curl -L https://foundry.paradigm.xyz | bash`)
- Monad RPC access

### 1. Deploy Contracts

```bash
cd contracts

# Install dependencies
forge install

# Build contracts
forge build

# Run tests
forge test -vv

# Deploy to Monad
forge script script/DeployVideoSession.s.sol \
  --rpc-url https://rpc.monad.xyz \
  --private-key YOUR_PRIVATE_KEY \
  --broadcast \
  -vvv
```

Save the contract addresses from deployment output.

### 2. Start Relayer

```bash
cd relayer

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with:
# - RPC_URL=https://rpc.monad.xyz
# - CHAIN_ID=143
# - RELAYER_PRIVATE_KEY=0x... (keeper private key)
# - LOGIC_CONTRACT=0x... (from deployment)
# - TOKEN=0x... (from deployment)
# - PAYEE=0x... (payment recipient)

# Build and start
npm run build
npm run dev
```

Relayer will be available at `http://localhost:3001`.

### 3. Start Web Frontend

```bash
cd web

# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
# Edit .env.local with:
# - NEXT_PUBLIC_RELAYER_URL=http://localhost:3001
# - NEXT_PUBLIC_LOGIC_CONTRACT=0x...
# - NEXT_PUBLIC_TOKEN=0x...

# Start development server
npm run dev
```

Visit `http://localhost:3000` to see the demo.

## User Flow

1. **Connect Wallet**: Users connect their Web3 wallet and switch to Monad network
2. **Start Watching**: Click "Start Watching" to:
   - Receive EIP-712 typed data for session request
   - Sign with wallet
   - Relayer sends type 4 transaction with EIP-7702 delegation
   - Contract records session start
3. **Automatic Billing**: Every 10 seconds:
   - Relayer calls `charge()` function
   - Contract transfers ERC20 tokens from user to payee
   - Updates session state
4. **Stop Watching**: Click "Stop Watching" to:
   - Relayer calls `closeSession()`
   - Relayer sends type 4 transaction to revoke delegation (delegate=0x0)

## Smart Contract Details

### VideoSessionLogic.sol

**Key Functions:**
- `createPolicy()` - Create billing policy (keeper, token, payee, rate, limits)
- `openSession(request, signature)` - Start session with EIP-712 verification
- `charge(sessionId, seconds)` - Process billing (keeper only)
- `closeSession(sessionId)` - End session
- `revokePolicy(policyId)` - Disable policy

**Storage:**
- Fixed slots using `keccak256("tickpay.policy")` and `keccak256("tickpay.session")`
- No CREATE/CREATE2 (Monad EIP-7702 limitation)

**Security:**
- `charge()` restricted to keeper address
- `openSession()` requires valid EIP-712 signature
- Nonce-based replay protection
- maxCost and maxSeconds hard limits
- No native MON transfers

## Testing

### Contract Tests

```bash
cd contracts
forge test -vv
```

Test coverage includes:
- Valid/invalid signature scenarios
- Keeper authorization
- maxCost enforcement
- Expiry validation
- Session state management

### Relayer Tests

```bash
cd relayer
npm test
```

### Web E2E Tests

```bash
cd web
npm run test
```

## Deployment to Production

### Monad Testnet

1. Deploy contracts to testnet
2. Configure relayer with testnet RPC
3. Deploy frontend (Vercel/Netlify)

### Monad Mainnet

1. Audit contracts
2. Deploy contracts to mainnet
3. Configure relayer with mainnet RPC
4. Deploy frontend

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment guide.

## Security Considerations

- **Keeper Private Key**: Store securely (use AWS KMS or HashiCorp Vault in production)
- **Rate Limiting**: Relayer API has rate limiting to prevent abuse
- **Signature Validation**: EIP-712 signatures verified on-chain
- **Replay Protection**: Nonce-based system prevents signature replay
- **No Arbitrary Execution**: Contract does not have generic execute function

## Monad-Specific Constraints

- **10 MON Reserve**: Delegated accounts must maintain >10 MON balance (we don't touch MON)
- **No CREATE/CREATE2**: Not supported in delegated calls on Monad
- **Type 4 Transactions**: Required for EIP-7702 authorization list

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.

## Acknowledgments

- [Monad](https://monad.xyz) - High-performance blockchain
- [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) - Account abstraction standard
- [Viem](https://viem.sh) - TypeScript interface for Ethereum
- [Foundry](https://getfoundry.sh) - Solidity development framework
