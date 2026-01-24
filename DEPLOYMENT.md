# TickPay Deployment Guide

Complete guide for deploying TickPay to Monad blockchain (testnet or mainnet).

## Prerequisites

- Foundry installed (`curl -L https://foundry.paradigm.xyz | bash`)
- Node.js 20+ installed
- Monad RPC access
- Wallet with sufficient MON for gas fees
- Deployment account with admin privileges

## Environment Variables

### Shared Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `CHAIN_ID` | Monad chain ID | `143` (mainnet) or `10143` (testnet) |
| `RPC_URL` | Monad RPC endpoint | `https://rpc.monad.xyz` |
| `LOGIC_CONTRACT` | VideoSessionLogic address | `0x...` (after deployment) |
| `TOKEN` | MockERC20 token address | `0x...` (after deployment) |
| `PAYEE` | Payment recipient address | `0x...` |
| `KEEPER_ADDRESS` | Relayer/keeper address | `0x...` |

## Phase 1: Smart Contract Deployment

### Step 1: Configure Deployment Environment

```bash
cd contracts
cp .env.example .env
```

Edit `.env`:
```env
# Deployment
PRIVATE_KEY=0x... # Your deployment private key
RPC_URL=https://rpc.monad.xyz
CHAIN_ID=143

# Policy Configuration
KEEPER_ADDRESS=0x... # Your relayer address
PAYEE_ADDRESS=0x...  # Payment recipient
```

### Step 2: Deploy Contracts

```bash
# Verify Foundry is installed
forge --version

# Build contracts
forge build --sizes

# Run tests
forge test -vv

# Deploy to Monad
forge script script/DeployVideoSession.s.sol:DeployVideoSession \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  -vvv
```

**Save the output:**
- `TOKEN_ADDRESS`: MockERC20 contract address
- `LOGIC_CONTRACT`: VideoSessionLogic contract address
- `POLICY_ID`: Initial policy ID

### Step 3: Verify Deployment

```bash
# Check token balance
cast call $TOKEN_ADDRESS "balanceOf(address)(uint256)" $YOUR_ADDRESS \
  --rpc-url $RPC_URL

# Check policy
cast call $LOGIC_CONTRACT "getPolicy(uint256,(address,address,address,uint256,uint256,uint256,uint256,bool))" 0 \
  --rpc-url $RPC_URL
```

### Step 4: Fund Users with Test Tokens

```bash
# Mint tokens to test users
cast send $TOKEN_ADDRESS \
  "mint(address,uint256)" \
  "0xUserAddress 1000000000000000000000" \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

## Phase 2: Relayer Deployment

### Step 1: Install Dependencies

```bash
cd ../relayer
npm install
```

### Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
# Monad Network
RPC_URL=https://rpc.monad.xyz
CHAIN_ID=143

# Relayer Account (keeper)
RELAYER_PRIVATE_KEY=0x... # Private key of KEEPER_ADDRESS
LOGIC_CONTRACT=0x...       # From Phase 1
TOKEN=0x...                # From Phase 1
PAYEE=0x...                # Payment recipient

# Billing Configuration
RATE_PER_SECOND=1000000000000000  # 0.001 tokens/sec
CHARGE_INTERVAL_SEC=10            # Charge every 10 seconds

# API Server
PORT=3001
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
NODE_ENV=production
```

### Step 3: Build and Test

```bash
# Build TypeScript
npm run build

# Type check
npm run typecheck

# Test locally
npm run dev
```

### Step 4: Production Deployment

#### Option A: Direct Node.js

```bash
# Using PM2 (recommended)
npm install -g pm2
pm2 start dist/main.js --name tickpay-relayer
pm2 save
pm2 startup

# Or directly
npm start
```

#### Option B: Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["node", "dist/main.js"]
```

Build and run:
```bash
docker build -t tickpay-relayer .
docker run -d -p 3001:3001 --env-file .env tickpay-relayer
```

#### Option C: Cloud Services

- **AWS ECS**: Use Fargate with environment variables
- **Google Cloud Run**: Deploy with --allow-unauthenticated
- **Railway/Render**: Connect GitHub repo, add environment variables

### Step 5: Verify Relayer

```bash
# Health check
curl http://localhost:3001/health

# Create session test
curl -X POST http://localhost:3001/api/session/create \
  -H "Content-Type: application/json" \
  -d '{"userAddress":"0x...","policyId":0}'
```

## Phase 3: Web Frontend Deployment

### Step 1: Configure Environment

```bash
cd ../web
cp .env.local.example .env.local
```

Edit `.env.local`:
```env
# Public variables (exposed to browser)
NEXT_PUBLIC_RELAYER_URL=https://relayer.yourdomain.com
NEXT_PUBLIC_LOGIC_CONTRACT=0x...
NEXT_PUBLIC_TOKEN=0x...
NEXT_PUBLIC_CHAIN_ID=143
NEXT_PUBLIC_RPC_URL=https://rpc.monad.xyz
```

### Step 2: Build and Test

```bash
# Install dependencies
npm install

# Type check
npm run typecheck

# Build
npm run build

# Test locally
npm start
```

### Step 3: Production Deployment

#### Option A: Vercel (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

Add environment variables in Vercel dashboard:
- `NEXT_PUBLIC_RELAYER_URL`
- `NEXT_PUBLIC_LOGIC_CONTRACT`
- `NEXT_PUBLIC_TOKEN`
- `NEXT_PUBLIC_CHAIN_ID`

#### Option B: Netlify

```bash
# Install Netlify CLI
npm i -g netlify-cli

# Deploy
netlify deploy --prod
```

#### Option C: Docker

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["npm", "start"]
```

#### Option D: Custom Server

```bash
# Use next start with production server
npm run build && npm start
# Or use PM2
pm2 start npm --name "tickpay-web" -- start
```

## Phase 4: Post-Deployment Verification

### 1. Contract Verification

```bash
# Verify on block explorer (if available)
forge verify-contract $LOGIC_CONTRACT \
  "VideoSessionLogic" \
  --chain-id 143 \
  --watch
```

### 2. End-to-End Test

1. **Connect Wallet**: Visit deployed site, connect wallet
2. **Switch Network**: Ensure wallet is on Monad
3. **Get Tokens**: Ensure test user has token balance
4. **Start Session**: Click "Start Watching"
5. **Verify Transaction**: Check block explorer for type 4 transaction
6. **Check Billing**: Wait 15-20 seconds, verify charges
7. **Stop Session**: Click "Stop Watching"
8. **Verify Revocation**: Check block explorer for revoke transaction

### 3. Monitoring

**Relayer Logs:**
```bash
# PM2 logs
pm2 logs tickpay-relayer

# Docker logs
docker logs -f tickpay-relayer
```

**Health Monitoring:**
```bash
# Add uptime monitoring (UptimeRobot, Pingdom)
# Monitor: https://relayer.yourdomain.com/health
```

**Contract Events:**
```bash
# Monitor SessionOpened events
cast logs --address $LOGIC_CONTRACT \
  --event "SessionOpened(bytes32 indexed,address indexed,uint256)" \
  --from-block $DEPLOYMENT_BLOCK \
  --rpc-url $RPC_URL
```

## Security Checklist

- [ ] Change default passwords/keys
- [ ] Enable HTTPS (TLS certificates)
- [ ] Set up rate limiting on relayer API
- [ ] Configure CORS properly
- [ ] Store private keys securely (AWS KMS, HashiCorp Vault)
- [ ] Enable fail2ban or similar intrusion prevention
- [ ] Set up log aggregation (ELK, Datadog)
- [ ] Configure alerts for suspicious activity
- [ ] Audit smart contracts (use professional auditor for mainnet)
- [ ] Test recovery procedures

## Troubleshooting

### Contract Issues

**"Invalid signature" error:**
- Check EIP-712 domain separator (chainId must match)
- Verify signature was signed by correct user address
- Check nonce hasn't been reused

**"Not authorized" in charge():**
- Verify msg.sender is the keeper address
- Check policy.keeper is set correctly
- Ensure relayer is using correct private key

### Relayer Issues

**"Failed to fetch" errors:**
- Check RELAYER_URL is correct
- Verify CORS is configured properly
- Check network connectivity

**Type 4 transaction failures:**
- Verify EIP-7702 authorization list is properly formatted
- Check user has sufficient gas for delegation
- Ensure nonce is correct

### Frontend Issues

**Wallet connection fails:**
- Check wallet is installed and unlocked
- Verify chain ID matches
- Check browser console for errors

**Session not starting:**
- Check user has sufficient token balance
- Verify contract addresses are correct
- Check relayer is running and accessible

## Rollback Procedure

### Relayer Rollback

```bash
# PM2
pm2 stop tickpay-relayer
pm2 revert tickpay-relayer  # If using version control

# Docker
docker stop tickpay-relayer
docker run -d -p 3001:3001 --env-file .env tickpay-relayer:previous-version
```

### Frontend Rollback

```bash
# Vercel
vercel rollback

# Netlify
netlify rollback

# Custom
git checkout previous-tag
npm run build
pm2 restart tickpay-web
```

### Contract Migration

1. Deploy new contract version
2. Migrate policy to new contract
3. Update relayer and frontend with new addresses
4. Deprecated contract remains for data retrieval

## Maintenance

### Regular Tasks

- **Daily**: Check relayer logs for errors
- **Weekly**: Review contract events and session metrics
- **Monthly**: Rotate keeper private keys
- **Quarterly**: Security audit and penetration testing

### Scaling

**Multiple Relayers:**
1. Deploy multiple relayer instances
2. Use load balancer (nginx, AWS ALB)
3. Share session state via Redis

**Database:**
- Move from in-memory to PostgreSQL
- Store session history and analytics

## Cost Estimates

### Gas Costs (Monad)

| Operation | Gas Used | Cost (MON) |
|-----------|----------|------------|
| Deploy MockERC20 | ~1M | ~0.001 MON |
| Deploy VideoSessionLogic | ~2M | ~0.002 MON |
| Create Policy | ~100k | ~0.0001 MON |
| Open Session (type 4) | ~200k | ~0.0002 MON |
| Charge | ~150k | ~0.00015 MON |
| Close Session | ~100k | ~0.0001 MON |
| Revoke Delegation (type 4) | ~100k | ~0.0001 MON |

### Infrastructure Costs

- **Relayer**: $5-20/month (VPS) or $10-50/month (cloud)
- **Frontend**: Free (Vercel/Netlify) or $5-20/month (VPS)
- **RPC**: Free (Monad public RPC) or $50-200/month (dedicated)
- **Monitoring**: $0-50/month (optional)

## Support

For issues and questions:
- GitHub Issues: [tickpay/issues](https://github.com/your-repo/tickpay/issues)
- Discord: [Join our server](https://discord.gg/...)
- Email: support@tickpay.example.com
