export type AddressLike = `0x${string}`;

export interface SessionRequest {
  user: AddressLike;
  policyId: bigint;
  nonce: bigint;
  deadline: bigint;
}

export interface SessionStatus {
  user: AddressLike;
  policyId: bigint;
  startedAt: bigint;
  chargedSeconds: bigint;
  chargedAmount: bigint;
  lastChargeAt: bigint;
  closed: boolean;
}

export interface Policy {
  keeper: AddressLike;
  token: AddressLike;
  payee: AddressLike;
  ratePerSecond: bigint;
  maxCost: bigint;
  maxSeconds: bigint;
  expiry: bigint;
  enabled: boolean;
}

export interface Authorization {
  address: AddressLike;
  chainId: number;
  nonce: number;
  r: `0x${string}`;
  s: `0x${string}`;
  v?: number;
  yParity?: number;
}
