# TickPay 部署指南

将 TickPay 部署到 Monad 区块链（测试网或主网）的完整指南。

## 前置要求

- 已安装 Foundry（`curl -L https://foundry.paradigm.xyz | bash`）
- 已安装 Node.js 20+
- 可访问 Monad RPC
- 钱包内有足够 MON 支付 gas
- 部署账户具备管理员权限

## 环境变量

### 通用变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `CHAIN_ID` | Monad 链 ID | `143`（主网）或 `10143`（测试网） |
| `RPC_URL` | Monad RPC 地址 | `https://rpc.monad.xyz` |
| `LOGIC_CONTRACT` | VideoSessionLogic 地址 | `0x...`（部署后） |
| `TOKEN` | MockERC20 地址 | `0x...`（部署后） |
| `PAYEE` | 收款地址 | `0x...` |
| `KEEPER_ADDRESS` | Relayer/Keeper 地址 | `0x...` |

## 阶段 1：智能合约部署

### 步骤 1：配置部署环境

```bash
cd contracts
cp .env.example .env
```

编辑 `.env`：

```env
# Deployment
PRIVATE_KEY=0x... # 部署账户私钥
RPC_URL=https://rpc.monad.xyz
CHAIN_ID=143

# Policy Configuration
KEEPER_ADDRESS=0x... # relayer 地址
PAYEE_ADDRESS=0x...  # 收款地址
```

### 步骤 2：部署合约

```bash
# 确认 Foundry 可用
forge --version

# 构建合约
forge build --sizes

# 运行测试
forge test -vv

# 部署到 Monad
forge script script/DeployVideoSession.s.sol:DeployVideoSession \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  -vvv
```

**保存部署输出：**

- `TOKEN_ADDRESS`：MockERC20 合约地址
- `LOGIC_CONTRACT`：VideoSessionLogic 合约地址
- `POLICY_ID`：初始策略 ID

### 步骤 3：验证部署

```bash
# 查询 token 余额
cast call $TOKEN_ADDRESS "balanceOf(address)(uint256)" $YOUR_ADDRESS \
  --rpc-url $RPC_URL

# 查询 policy
cast call $LOGIC_CONTRACT "getPolicy(uint256,(address,address,address,uint256,uint256,uint256,uint256,bool))" 0 \
  --rpc-url $RPC_URL
```

### 步骤 4：为测试用户发放代币

```bash
# 给测试用户 mint 代币
cast send $TOKEN_ADDRESS \
  "mint(address,uint256)" \
  "0xUserAddress 1000000000000000000000" \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

## 阶段 2：Relayer 部署

### 步骤 1：安装依赖

```bash
cd ../relayer
npm install
```

### 步骤 2：配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`：

```env
# Monad Network
RPC_URL=https://rpc.monad.xyz
CHAIN_ID=143

# Relayer Account (keeper)
RELAYER_PRIVATE_KEY=0x... # KEEPER_ADDRESS 对应私钥
LOGIC_CONTRACT=0x...       # 来自阶段 1
TOKEN=0x...                # 来自阶段 1
PAYEE=0x...                # 收款地址

# Billing Configuration
RATE_PER_SECOND=1000000000000000  # 0.001 token/秒
CHARGE_INTERVAL_SEC=10            # 每 10 秒扣费

# API Server
PORT=3001
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
NODE_ENV=production
```

### 步骤 3：构建与测试

```bash
# 构建 TypeScript
npm run build

# 类型检查
npm run typecheck

# 本地测试
npm run dev
```

### 步骤 4：生产部署

#### 方案 A：直接运行 Node.js

```bash
# 使用 PM2（推荐）
npm install -g pm2
pm2 start dist/main.js --name tickpay-relayer
pm2 save
pm2 startup

# 或直接运行
npm start
```

#### 方案 B：Docker

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

构建并运行：

```bash
docker build -t tickpay-relayer .
docker run -d -p 3001:3001 --env-file .env tickpay-relayer
```

#### 方案 C：云服务

- **AWS ECS**：使用 Fargate 并配置环境变量
- **Google Cloud Run**：部署时启用 `--allow-unauthenticated`
- **Railway/Render**：连接 GitHub 仓库并添加环境变量

### 步骤 5：验证 Relayer

```bash
# 健康检查
curl http://localhost:3001/health

# 创建会话测试
curl -X POST http://localhost:3001/api/session/create \
  -H "Content-Type: application/json" \
  -d '{"userAddress":"0x...","policyId":0}'
```

## 阶段 3：Web 前端部署

### 步骤 1：配置环境变量

```bash
cd ../web
cp .env.local.example .env.local
```

编辑 `.env.local`：

```env
# Public variables（会暴露到浏览器）
NEXT_PUBLIC_RELAYER_URL=https://relayer.yourdomain.com
NEXT_PUBLIC_LOGIC_CONTRACT=0x...
NEXT_PUBLIC_TOKEN=0x...
NEXT_PUBLIC_CHAIN_ID=143
NEXT_PUBLIC_RPC_URL=https://rpc.monad.xyz
```

### 步骤 2：构建与测试

```bash
# 安装依赖
npm install

# 类型检查
npm run typecheck

# 构建
npm run build

# 本地验证
npm start
```

### 步骤 3：生产部署

#### 方案 A：Vercel（推荐）

```bash
# 安装 Vercel CLI
npm i -g vercel

# 部署
vercel --prod
```

在 Vercel 控制台添加环境变量：

- `NEXT_PUBLIC_RELAYER_URL`
- `NEXT_PUBLIC_LOGIC_CONTRACT`
- `NEXT_PUBLIC_TOKEN`
- `NEXT_PUBLIC_CHAIN_ID`

#### 方案 B：Netlify

```bash
# 安装 Netlify CLI
npm i -g netlify-cli

# 部署
netlify deploy --prod
```

#### 方案 C：Docker

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

#### 方案 D：自建服务器

```bash
# 使用 next start 生产模式运行
npm run build && npm start
# 或使用 PM2
pm2 start npm --name "tickpay-web" -- start
```

## 阶段 4：部署后验证

### 1. 合约验证

```bash
# 在区块浏览器验证（如支持）
forge verify-contract $LOGIC_CONTRACT \
  "VideoSessionLogic" \
  --chain-id 143 \
  --watch
```

### 2. 端到端测试

1. **连接钱包**：打开已部署站点并连接钱包
2. **切换网络**：确认钱包在 Monad 网络
3. **准备代币**：确认测试账户有足够 token
4. **开始会话**：点击 “Start Watching”
5. **验证交易**：在浏览器查看 Type 4 交易
6. **检查扣费**：等待 15-20 秒，确认发生扣费
7. **结束会话**：点击 “Stop Watching”
8. **验证撤销**：检查 revoke 交易是否上链

### 3. 监控

**Relayer 日志：**

```bash
# PM2 日志
pm2 logs tickpay-relayer

# Docker 日志
docker logs -f tickpay-relayer
```

**健康检查监控：**

```bash
# 可接入 UptimeRobot、Pingdom 等
# 监控地址: https://relayer.yourdomain.com/health
```

**合约事件：**

```bash
# 监听 SessionOpened 事件
cast logs --address $LOGIC_CONTRACT \
  --event "SessionOpened(bytes32 indexed,address indexed,uint256)" \
  --from-block $DEPLOYMENT_BLOCK \
  --rpc-url $RPC_URL
```

## 安全检查清单

- [ ] 更换默认密码/密钥
- [ ] 启用 HTTPS（TLS 证书）
- [ ] Relayer API 启用限流
- [ ] 正确配置 CORS
- [ ] 安全存储私钥（AWS KMS、HashiCorp Vault）
- [ ] 启用 fail2ban 等入侵防护
- [ ] 配置日志聚合（ELK、Datadog）
- [ ] 配置异常活动告警
- [ ] 智能合约审计（主网建议专业审计）
- [ ] 演练恢复流程

## 故障排查

### 合约问题

**"Invalid signature" 错误：**

- 检查 EIP-712 domain separator（chainId 必须一致）
- 校验签名地址是否为正确用户地址
- 检查 nonce 是否被重复使用

**`charge()` 报 "Not authorized"：**

- 校验 `msg.sender` 是否为 keeper 地址
- 检查 `policy.keeper` 是否正确
- 确认 relayer 使用的是正确私钥

### Relayer 问题

**"Failed to fetch" 错误：**

- 检查 `RELAYER_URL` 是否正确
- 确认 CORS 配置正确
- 检查网络连通性

**Type 4 交易失败：**

- 校验 EIP-7702 authorization list 格式
- 检查用户 gas 是否充足
- 确认 nonce 正确

### 前端问题

**钱包连接失败：**

- 确认钱包已安装并解锁
- 校验 chain ID 是否一致
- 查看浏览器控制台错误

**会话无法启动：**

- 检查用户 token 余额是否充足
- 校验合约地址配置是否正确
- 确认 relayer 已运行且可访问

## 回滚流程

### Relayer 回滚

```bash
# PM2
pm2 stop tickpay-relayer
pm2 revert tickpay-relayer  # 若有版本管理

# Docker
docker stop tickpay-relayer
docker run -d -p 3001:3001 --env-file .env tickpay-relayer:previous-version
```

### 前端回滚

```bash
# Vercel
vercel rollback

# Netlify
netlify rollback

# 自建
git checkout previous-tag
npm run build
pm2 restart tickpay-web
```

### 合约迁移

1. 部署新版本合约
2. 将策略迁移到新合约
3. 更新 relayer 与前端中的合约地址
4. 旧合约保留仅用于数据查询

## 维护

### 常规任务

- **每日**：检查 relayer 错误日志
- **每周**：审查合约事件与会话指标
- **每月**：轮换 keeper 私钥
- **每季度**：安全审计与渗透测试

### 扩展

**多 Relayer：**

1. 部署多个 relayer 实例
2. 使用负载均衡（nginx、AWS ALB）
3. 使用 Redis 共享会话状态

**数据库：**

- 从内存存储迁移到 PostgreSQL
- 记录会话历史与分析数据

## 成本估算

### Gas 成本（Monad）

| 操作 | Gas 用量 | 成本（MON） |
|------|----------|-------------|
| 部署 MockERC20 | ~1M | ~0.001 MON |
| 部署 VideoSessionLogic | ~2M | ~0.002 MON |
| 创建策略 | ~100k | ~0.0001 MON |
| 开启会话（Type 4） | ~200k | ~0.0002 MON |
| 扣费 | ~150k | ~0.00015 MON |
| 结束会话 | ~100k | ~0.0001 MON |
| 撤销委托（Type 4） | ~100k | ~0.0001 MON |

### 基础设施成本

- **Relayer**：$5-20/月（VPS）或 $10-50/月（云服务）
- **前端**：免费（Vercel/Netlify）或 $5-20/月（VPS）
- **RPC**：免费（Monad 公共 RPC）或 $50-200/月（专用 RPC）
- **监控**：$0-50/月（可选）

## 支持

如有问题请联系：

- GitHub Issues: [tickpay/issues](https://github.com/FWangZil/tickpay-monad/issues)
