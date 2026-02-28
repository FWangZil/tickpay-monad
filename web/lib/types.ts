import type {
  AddressLike,
  Policy as SDKPolicy,
  SessionRequest as SDKSessionRequest,
} from "@tickpay/sdk";
import type {
  CreateSessionResponse,
  SessionStatusResponse,
  StartSessionResponse,
  StopSessionResponse
} from "@tickpay/sdk/client/relayerHttp";

export type Address = AddressLike;

export type Session = SessionStatusResponse;
export type Policy = SDKPolicy;
export type SessionRequest = SDKSessionRequest;

export type {
  CreateSessionResponse,
  StartSessionResponse,
  StopSessionResponse,
  SessionStatusResponse
};

export interface WalletState {
  isConnected: boolean;
  address: Address | null;
  chainId: number | null;
}

export interface VideoState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

export interface AppState {
  wallet: WalletState;
  video: VideoState;
  session: Session | null;
  activeSessionId: string | null;
}
