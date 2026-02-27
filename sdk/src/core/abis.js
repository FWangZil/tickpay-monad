export const VIDEO_SESSION_LOGIC_ABI = [
  {
    type: "function",
    name: "getSession",
    stateMutability: "view",
    inputs: [{ name: "sessionId", type: "bytes32" }],
    outputs: [
      { name: "user", type: "address" },
      { name: "policyId", type: "uint256" },
      { name: "startedAt", type: "uint256" },
      { name: "chargedSeconds", type: "uint256" },
      { name: "chargedAmount", type: "uint256" },
      { name: "lastChargeAt", type: "uint256" },
      { name: "closed", type: "bool" }
    ]
  },
  {
    type: "function",
    name: "getPolicy",
    stateMutability: "view",
    inputs: [{ name: "policyId", type: "uint256" }],
    outputs: [
      { name: "keeper", type: "address" },
      { name: "token", type: "address" },
      { name: "payee", type: "address" },
      { name: "ratePerSecond", type: "uint256" },
      { name: "maxCost", type: "uint256" },
      { name: "maxSeconds", type: "uint256" },
      { name: "expiry", type: "uint256" },
      { name: "enabled", type: "bool" }
    ]
  },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "sessionCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "openSession",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "user", type: "address" },
          { name: "policyId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      },
      { name: "signature", type: "bytes" }
    ],
    outputs: [{ name: "sessionId", type: "bytes32" }]
  },
  {
    type: "function",
    name: "openSessionWithPolicy",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "user", type: "address" },
          { name: "policyId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      },
      { name: "signature", type: "bytes" },
      { name: "keeper", type: "address" },
      { name: "token", type: "address" },
      { name: "payee", type: "address" },
      { name: "ratePerSecond", type: "uint256" },
      { name: "maxCost", type: "uint256" },
      { name: "maxSeconds", type: "uint256" },
      { name: "expiry", type: "uint256" }
    ],
    outputs: [{ name: "sessionId", type: "bytes32" }]
  },
  {
    type: "function",
    name: "charge",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sessionId", type: "bytes32" },
      { name: "secondsToBill", type: "uint256" }
    ]
  },
  {
    type: "function",
    name: "closeSession",
    stateMutability: "nonpayable",
    inputs: [{ name: "sessionId", type: "bytes32" }]
  },
  {
    type: "event",
    name: "SessionOpened",
    inputs: [
      { name: "sessionId", type: "bytes32", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "policyId", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "SessionCharged",
    inputs: [
      { name: "sessionId", type: "bytes32", indexed: true },
      { name: "seconds", type: "uint256", indexed: false },
      { name: "amount", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "SessionClosed",
    inputs: [{ name: "sessionId", type: "bytes32", indexed: true }]
  }
];

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  }
];

export const NONCES_ABI = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  }
];
