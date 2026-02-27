import type { Address, Hash, Hex } from "viem";
import type { Authorization } from "../core/types";

export declare const ZERO_ADDRESS: Address;

export interface BuildAuthorizationParams {
  publicClient: any;
  userPrivateKey: Hex;
  delegateAddress: Address;
  chainId: number;
  nonce?: bigint | number;
}

export interface RevokeDelegationParams {
  publicClient: any;
  walletClient: any;
  userAddress: Address;
  userPrivateKey: Hex;
  chainId: number;
  keeperAddress: Address;
}

export declare function buildAuthorization(
  params: BuildAuthorizationParams
): Promise<Authorization>;

export declare function revokeDelegation(
  params: RevokeDelegationParams
): Promise<Hash>;
