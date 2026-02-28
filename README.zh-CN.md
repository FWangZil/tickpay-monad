# TickPay - 基于 Monad 的按秒视频计费系统

一个基于 Monad 区块链、使用 EIP-7702 账户抽象实现的按秒视频计费系统。用户在播放视频期间将账户临时委托给智能合约，由 relayer 自动扣费，观看结束后立即撤销委托。

## 功能特性

- **EIP-7702 账户抽象**：用户 EOA 临时委托给计费合约
- **按秒计费**：视频播放期间每 10 秒自动扣费
- **一键开始/停止**：通过 relayer 快速完成委托与撤销
- **仅 Keeper 可扣费**：只有授权的 relayer 能执行扣费
- **ERC20 支付**：不涉及原生 MON 转账（规避 10 MON 预留规则）
- **Type 4 交易**：完整支持 EIP-7702 authorization list

## 架构

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

## 项目结构

```
tickpay/
├── contracts/              # Foundry 智能合约
│   ├── src/
│   │   ├── VideoSessionLogic.sol    # 核心计费逻辑
│   │   ├── MockERC20.sol            # 测试 ERC20 代币
│   │   └── interfaces/
│   │       └── IERC20.sol
│   ├── test/
│   │   └── VideoSessionLogic.t.sol  # 测试套件
│   └── script/
│       └── DeployVideoSession.s.sol # 部署脚本
├── relayer/                # Node.js + Viem relayer 服务
│   └── src/
│       ├── client.ts                   # Viem 客户端配置
│       ├── tx7702.ts                   # EIP-7702 授权构建
│       ├── session.ts                  # 会话管理
│       ├── eip712.ts                   # EIP-712 签名工具
│       ├── server.ts                   # Express API 服务
│       ├── main.ts                     # 入口
│       └── api/
│           ├── create.ts               # 创建会话接口
│           ├── start.ts                # 开始会话接口
│           ├── stop.ts                 # 结束会话接口
│           └── status.ts               # 会话状态接口
├── web/                    # Next.js 前端
│   └── app/
│       ├── page.tsx                    # 视频播放 + 计费 UI
│       ├── layout.tsx                  # 根布局
│       ├── globals.css                 # 样式
│       └── api/session/                # API 路由
│   └── lib/
│       ├── viem.ts                     # Viem 客户端配置
│       ├── eip712.ts                   # EIP-712 domain + types
│       └── types.ts                    # TypeScript 类型定义
├── sdk/                    # 可复用 TickPay SDK（core + client + server engine）
│   ├── src/core/                      # ABI、EIP-712、共享类型
│   ├── src/client/                    # Relayer HTTP 客户端
│   └── src/server/                    # 适用于 relayer 服务的会话引擎
├── examples/
│   └── minimal-relayer/               # 最小可运行 SDK relayer 示例
└── README.md
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 区块链 | Monad（Chain ID 143） |
| 智能合约 | Solidity ^0.8.13, Foundry |
| Relayer | Node.js, TypeScript, Viem, Express |
| 前端 | Next.js 15, React, Tailwind CSS, Viem |
| 账户抽象 | EIP-7702 |

## 快速开始

### 前置要求

- Node.js 20+
- Foundry（`curl -L https://foundry.paradigm.xyz | bash`）
- Monad RPC 访问能力

### 1. 部署合约

```bash
cd contracts

# 安装依赖
forge install

# 构建合约
forge build

# 运行测试
forge test -vv

# 部署到 Monad
forge script script/DeployVideoSession.s.sol \
  --rpc-url https://rpc.monad.xyz \
  --private-key YOUR_PRIVATE_KEY \
  --broadcast \
  -vvv
```

从部署输出中保存合约地址。

### 2. 启动 Relayer

```bash
cd relayer

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env：
# - RPC_URL=https://rpc.monad.xyz
# - CHAIN_ID=143
# - RELAYER_PRIVATE_KEY=0x...（keeper 私钥）
# - LOGIC_CONTRACT=0x...（部署输出）
# - TOKEN=0x...（部署输出）
# - PAYEE=0x...（收款地址）
# - SESSION_STORE=file|memory（默认：file）
# - SESSION_STORE_FILE=.tickpay/sessions.json（可选）

# 构建并启动
npm run build
npm run dev
```

Relayer 默认监听 `http://localhost:3001`。

### 3. 启动 Web 前端

```bash
cd web

# 安装依赖
npm install

# 配置环境变量
cp .env.local.example .env.local
# 编辑 .env.local：
# - NEXT_PUBLIC_RELAYER_URL=http://localhost:3001
# - NEXT_PUBLIC_LOGIC_CONTRACT=0x...
# - NEXT_PUBLIC_TOKEN=0x...

# 启动开发服务器
npm run dev
```

访问 `http://localhost:3000` 查看演示。

### 4. 运行最小 SDK 示例（可选）

```bash
cd examples/minimal-relayer
npm install
cp .env.example .env
npm run dev
```

## 用户流程

1. **连接钱包**：用户连接 Web3 钱包并切换到 Monad 网络
2. **开始观看**：点击 “Start Watching” 后：
   - 获取会话请求的 EIP-712 typed data
   - 使用钱包签名
   - Relayer 发送含 EIP-7702 delegation 的 Type 4 交易
   - 合约记录会话开始
3. **自动扣费**：每 10 秒：
   - Relayer 调用 `charge()`
   - 合约将 ERC20 从用户转给收款方
   - 更新会话状态
4. **停止观看**：点击 “Stop Watching” 后：
   - Relayer 调用 `closeSession()`
   - Relayer 发送 Type 4 交易撤销委托（delegate=0x0）

## 智能合约细节

### VideoSessionLogic.sol

**关键函数：**

- `createPolicy()`：创建计费策略（keeper、token、payee、费率、限制）
- `openSession(request, signature)`：通过 EIP-712 校验开启会话
- `charge(sessionId, seconds)`：执行扣费（仅 keeper）
- `closeSession(sessionId)`：结束会话
- `revokePolicy(policyId)`：禁用策略

**存储：**

- 使用 `keccak256("tickpay.policy")` 和 `keccak256("tickpay.session")` 的固定槽位
- 不使用 CREATE/CREATE2（Monad 对 EIP-7702 调用的限制）

**安全性：**

- `charge()` 限制为 keeper 地址调用
- `openSession()` 要求有效 EIP-712 签名
- 基于 nonce 的重放保护
- `maxCost` 与 `maxSeconds` 硬限制
- 不涉及原生 MON 转账

## 测试

### 合约测试

```bash
cd contracts
forge test -vv
```

测试覆盖包括：

- Keeper 授权
- maxCost 限制
- 过期时间校验
- 会话状态管理

### Relayer 测试

```bash
cd relayer
npm test
```

### Web E2E 测试

```bash
cd web
npm run test
```

## 生产部署

### Monad 测试网

1. 部署合约到测试网
2. 使用测试网 RPC 配置 relayer
3. 部署前端（Vercel/Netlify）

### Monad 主网

1. 审计合约
2. 部署合约到主网
3. 使用主网 RPC 配置 relayer
4. 部署前端

详细步骤见 [DEPLOYMENT.md](./DEPLOYMENT.md)（中文版本见 [DEPLOYMENT.zh-CN.md](./DEPLOYMENT.zh-CN.md)）。

## 安全注意事项

- **Keeper 私钥**：安全存储（生产建议使用 AWS KMS 或 HashiCorp Vault）
- **限流**：Relayer API 应启用限流防止滥用
- **签名校验**：链上校验 EIP-712 签名
- **重放保护**：基于 nonce 防止签名重放
- **禁止任意执行**：合约不提供通用 execute 函数

## Monad 特定约束

- **10 MON 预留**：被委托账户需保持 >10 MON 余额（本方案不触碰 MON）
- **不支持 CREATE/CREATE2**：Monad 上 delegated call 不支持
- **Type 4 交易**：EIP-7702 authorization list 必需

## 许可证

MIT

## 贡献

欢迎贡献！请提交 issue 或 PR。

## 致谢

- [Monad](https://monad.xyz) - 高性能区块链
- [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) - 账户抽象标准
- [Viem](https://viem.sh) - TypeScript 以太坊接口
- [Foundry](https://getfoundry.sh) - Solidity 开发框架
