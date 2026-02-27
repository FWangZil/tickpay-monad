import type { SessionRequest } from "./types";

export declare const TICKPAY_EIP712_DOMAIN_NAME: "TickPay";
export declare const TICKPAY_EIP712_DOMAIN_VERSION: "1";

export declare const TICKPAY_EIP712_TYPES: {
  readonly SessionRequest: readonly [
    { readonly name: "user"; readonly type: "address" },
    { readonly name: "policyId"; readonly type: "uint256" },
    { readonly name: "nonce"; readonly type: "uint256" },
    { readonly name: "deadline"; readonly type: "uint256" }
  ];
};

export declare function getDeadline(secondsFromNow?: number): bigint;
export declare function isDeadlineExpired(deadline: bigint): boolean;
export declare function createSessionRequest(
  userAddress: `0x${string}`,
  policyId: bigint,
  nonce: bigint,
  deadlineMinutes?: number
): SessionRequest;

export declare function buildSessionRequestDomain(
  chainId: number,
  verifyingContract: `0x${string}`
): {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: `0x${string}`;
};

export declare function toSessionRequestMessage(request: SessionRequest): {
  user: `0x${string}`;
  policyId: string;
  nonce: string;
  deadline: string;
};

export declare function buildSessionRequestTypedData(
  chainId: number,
  verifyingContract: `0x${string}`,
  request: SessionRequest
): {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: typeof TICKPAY_EIP712_TYPES;
  primaryType: "SessionRequest";
  message: {
    user: `0x${string}`;
    policyId: string;
    nonce: string;
    deadline: string;
  };
};
