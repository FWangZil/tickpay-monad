import { privateKeyToAccount } from "viem/accounts";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function normalizeSignature(authorization) {
  return {
    address: authorization.address,
    chainId: Number(authorization.chainId),
    nonce: Number(authorization.nonce),
    r: authorization.r,
    s: authorization.s,
    v: typeof authorization.v === "bigint" ? Number(authorization.v) : authorization.v,
    yParity:
      typeof authorization.yParity === "bigint"
        ? Number(authorization.yParity)
        : authorization.yParity,
  };
}

/**
 * Build EIP-7702 authorization object for a delegate target.
 */
export async function buildAuthorization({
  publicClient,
  userPrivateKey,
  delegateAddress,
  chainId,
  nonce,
}) {
  const account = privateKeyToAccount(userPrivateKey);
  const resolvedNonce =
    nonce ??
    (await publicClient.getTransactionCount({
      address: account.address,
    }));

  const authorization = await account.signAuthorization({
    address: delegateAddress,
    chainId,
    nonce: resolvedNonce,
  });

  return normalizeSignature(authorization);
}

/**
 * Revoke EIP-7702 delegation by setting delegate target to zero address.
 * Sends a type-4 tx from relayer account with authorizationList for the user.
 */
export async function revokeDelegation({
  publicClient,
  walletClient,
  userAddress,
  userPrivateKey,
  chainId,
  keeperAddress,
}) {
  const nonce = await publicClient.getTransactionCount({ address: userAddress });
  const revokeAuthorization = await buildAuthorization({
    publicClient,
    userPrivateKey,
    delegateAddress: ZERO_ADDRESS,
    chainId,
    nonce,
  });

  // `to` uses keeper EOA + empty calldata as a no-op execution target,
  // while the authorization list applies the actual delegation revoke.
  const txHash = await walletClient.sendTransaction({
    to: keeperAddress,
    value: 0n,
    data: "0x",
    authorizationList: [revokeAuthorization],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error("revoke delegation transaction reverted");
  }

  const codeAfterRevoke = await publicClient.getCode({ address: userAddress });
  if (codeAfterRevoke && codeAfterRevoke !== "0x") {
    throw new Error(
      `delegation revoke verification failed, user code is still set: ${codeAfterRevoke}`
    );
  }

  return txHash;
}
