export const TICKPAY_EIP712_DOMAIN_NAME = "TickPay";
export const TICKPAY_EIP712_DOMAIN_VERSION = "1";

export const TICKPAY_EIP712_TYPES = {
  SessionRequest: [
    { name: "user", type: "address" },
    { name: "policyId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }
  ]
};

function nowUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function getDeadline(secondsFromNow = 3600) {
  return BigInt(nowUnixSeconds() + secondsFromNow);
}

export function isDeadlineExpired(deadline) {
  return BigInt(nowUnixSeconds()) > BigInt(deadline);
}

export function createSessionRequest(userAddress, policyId, nonce, deadlineMinutes = 60) {
  return {
    user: userAddress,
    policyId: BigInt(policyId),
    nonce: BigInt(nonce),
    deadline: BigInt(nowUnixSeconds() + deadlineMinutes * 60)
  };
}

export function buildSessionRequestDomain(chainId, verifyingContract) {
  return {
    name: TICKPAY_EIP712_DOMAIN_NAME,
    version: TICKPAY_EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract
  };
}

export function toSessionRequestMessage(request) {
  return {
    user: request.user,
    policyId: request.policyId.toString(),
    nonce: request.nonce.toString(),
    deadline: request.deadline.toString()
  };
}

export function buildSessionRequestTypedData(chainId, verifyingContract, request) {
  return {
    domain: buildSessionRequestDomain(chainId, verifyingContract),
    types: TICKPAY_EIP712_TYPES,
    primaryType: "SessionRequest",
    message: toSessionRequestMessage(request)
  };
}
