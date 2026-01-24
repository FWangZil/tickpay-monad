"use client";

import { useState, useEffect, useRef } from "react";
import { usePrivy, useWallets, useSign7702Authorization } from "@privy-io/react-auth";
import { recoverTypedDataAddress } from "viem";
import {
  checkExistingDelegation,
  NEXT_PUBLIC_LOGIC_CONTRACT,
  NEXT_PUBLIC_CHAIN_ID,
} from "@/lib/viem";
import type { Session, Address } from "@/lib/types";

export default function Home() {
  // Relayer URL from env
  const relayerUrl = process.env.NEXT_PUBLIC_RELAYER_URL || "https://api-tickpay.ngrok.app";

  // Privy hooks
  const { login, logout, authenticated, ready, user } = usePrivy();
  const { wallets } = useWallets();
  const { signAuthorization } = useSign7702Authorization();

  // Wallet state (derived from Privy)
  const [walletAddress, setWalletAddress] = useState<Address | null>(null);
  const [isCorrectChain, setIsCorrectChain] = useState(false);

  // Session state
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Delegation state
  const [existingDelegation, setExistingDelegation] = useState<Address | null>(null);
  const [showDelegationWarning, setShowDelegationWarning] = useState(false);

  // Faucet state
  const [isFaucetLoading, setIsFaucetLoading] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<string | null>(null);

  // Video state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const startInProgressRef = useRef(false);

  // Polling interval ref
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Update wallet address when Privy wallets change
  useEffect(() => {
    if (wallets.length > 0) {
      const embeddedWallet = wallets.find(w => w.walletClientType === 'privy') || wallets[0];
      setWalletAddress(embeddedWallet.address as Address);
      // Check chain - Privy handles chain switching
      setIsCorrectChain(true); // Privy is configured for Monad Testnet
    } else {
      setWalletAddress(null);
      setIsCorrectChain(false);
    }
  }, [wallets]);

  // Poll session status when active
  useEffect(() => {
    if (activeSessionId) {
      pollingIntervalRef.current = setInterval(async () => {
        await fetchSessionStatus(activeSessionId);
      }, 5000); // Poll every 5 seconds
    } else if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [activeSessionId]);

  // Handle connect wallet with Privy
  async function handleConnectWallet() {
    try {
      setIsLoading(true);
      setError(null);
      await login();
    } catch (error: any) {
      setError(error.message || "Failed to connect wallet");
    } finally {
      setIsLoading(false);
    }
  }

  // Handle faucet request
  async function handleFaucet() {
    if (!walletAddress || isFaucetLoading) return;

    try {
      setIsFaucetLoading(true);
      setError(null);

      const response = await fetch(`${relayerUrl}/api/faucet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: walletAddress }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to get tokens");
      }

      // Update balance display
      const balanceInTokens = (Number(data.balanceAfter) / 1e18).toFixed(2);
      setTokenBalance(balanceInTokens);

      console.log("Faucet success:", data);
    } catch (error: any) {
      setError(error.message || "Failed to get tokens from faucet");
    } finally {
      setIsFaucetLoading(false);
    }
  }

  async function handleStartWatching(skipDelegationCheck = false) {
    if (startInProgressRef.current || activeSessionId) {
      return;
    }
    startInProgressRef.current = true;
    console.log("handleStartWatching called", { walletAddress, isCorrectChain });
    if (!walletAddress) {
      setError("Please connect your wallet first");
      startInProgressRef.current = false;
      return;
    }

    if (!isCorrectChain) {
      setError("Please switch to Monad network");
      startInProgressRef.current = false;
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Step 0: Check for existing delegation (unless skipped)
      if (!skipDelegationCheck) {
        console.log("Checking for existing delegation...");
        const existingDelegate = await checkExistingDelegation(walletAddress);
        if (existingDelegate) {
          console.log("Found existing delegation:", existingDelegate);
          setExistingDelegation(existingDelegate);
          setShowDelegationWarning(true);
          setIsLoading(false);
          startInProgressRef.current = false;
          // Pause video while showing warning
          if (videoRef.current && !videoRef.current.paused) {
            videoRef.current.pause();
          }
          return;
        }
      }

      // Step 1: Create session (get EIP-712 data)
      console.log("Step 1: Creating session request...");
      const createResponse = await fetch(`${relayerUrl}/api/session/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: walletAddress,
          policyId: 0, // Use default policy
        }),
      });

      const createData = await createResponse.json();
      console.log("Session created:", createData);
      console.log("Domain from relayer:", createData.domain);

      if (!createResponse.ok) {
        throw new Error(createData.error || "Failed to create session");
      }

      // Step 2: Build EIP-7702 delegation authorization using Privy
      console.log("Step 2: Building delegation authorization with Privy...");
      const authorization = await signAuthorization({
        contractAddress: NEXT_PUBLIC_LOGIC_CONTRACT,
        chainId: NEXT_PUBLIC_CHAIN_ID,
      }, {
        address: walletAddress,
      });
      console.log("Delegation authorization ready:", authorization);

      // Step 3: Sign EIP-712 data using Privy wallet
      console.log("Step 3: Signing request with Privy wallet...");

      // Get the Privy wallet provider
      const wallet = wallets.find(w => w.address.toLowerCase() === walletAddress.toLowerCase());
      if (!wallet) throw new Error("Wallet not found");

      const provider = await wallet.getEthereumProvider();

      const typedData = {
        domain: createData.domain,
        types: createData.types,
        primaryType: "SessionRequest",
        message: createData.message,
      };

      console.log("Signing typed data:", typedData);

      const signature = await provider.request({
        method: "eth_signTypedData_v4",
        params: [walletAddress, JSON.stringify(typedData)],
      });
      console.log("Signature received:", signature);

      // Recover actual signer address from signature
      const actualSigner = await recoverTypedDataAddress({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
        signature: signature as `0x${string}`,
      });
      console.log("Actual signer recovered:", actualSigner);
      console.log("Expected signer:", walletAddress);

      if (actualSigner.toLowerCase() !== walletAddress.toLowerCase()) {
        console.warn("⚠️ Signer mismatch! Using actual signer for session request.");
      }

      // Step 4: Start session (relayer sends delegation tx)
      console.log("Step 4: Starting session with relayer...");

      // Convert BigInt values to numbers for JSON serialization
      const authForJson = {
        address: authorization.address,
        chainId: Number(authorization.chainId),
        nonce: Number(authorization.nonce),
        r: authorization.r,
        s: authorization.s,
        v: authorization.v !== undefined ? Number(authorization.v) : undefined,
        yParity: authorization.yParity !== undefined ? Number(authorization.yParity) : undefined,
      };

      const startResponse = await fetch(`${relayerUrl}/api/session/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: walletAddress,
          signature,
          policyId: 0,
          authorizationList: [authForJson],
          deadline: createData.deadline,
          nonce: createData.nonce,
        }),
      });

      const startData = await startResponse.json();
      console.log("Session started:", startData);

      if (!startResponse.ok) {
        console.error("Start session failed", {
          status: startResponse.status,
          details: startData?.details,
          error: startData?.error,
        });
        throw new Error(startData.error || "Failed to start session");
      }

      setActiveSessionId(startData.sessionId);
      // Note: Video is already playing since user triggered this by clicking play
      // Do NOT call videoRef.current.play() here as it would re-trigger handleVideoPlay
      // before activeSessionId state is updated (React async state update)
    } catch (error: any) {
      console.error("Error in handleStartWatching:", error);
      setError(error.message || "Failed to start session");
    } finally {
      setIsLoading(false);
      startInProgressRef.current = false;
    }
  }

  async function handleStopWatching() {
    if (!activeSessionId || !walletAddress) return;

    await stopActiveSession();

    // Pause video
    if (videoRef.current) {
      videoRef.current.pause();
    }
  }

  async function stopActiveSession() {
    if (!activeSessionId || !walletAddress) return;

    try {
      setIsLoading(true);

      const response = await fetch(`${relayerUrl}/api/session/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSessionId,
          userAddress: walletAddress,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to stop session");
      }

      setActiveSessionId(null);
      setSessionStatus(null);
    } catch (error: any) {
      setError(error.message || "Failed to stop session");
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchSessionStatus(sessionId: string) {
    try {
      const response = await fetch(`${relayerUrl}/api/session/status/${sessionId}`);
      const data = await response.json();

      if (response.ok) {
        setSessionStatus(data);
        if (data.closed) {
          setActiveSessionId(null);
        }
      }
    } catch (error) {
      console.error("Error fetching session status:", error);
    }
  }

  function handleVideoPlay() {
    setIsPlaying(true);
    if (!activeSessionId && walletAddress && !startInProgressRef.current) {
      handleStartWatching();
    }
  }

  function handleVideoPause() {
    setIsPlaying(false);
    if (activeSessionId) {
      handleStopWatching();
    }
  }

  function handleVideoEnded() {
    setIsPlaying(false);
    if (activeSessionId) {
      handleStopWatching();
    }
  }

  function handleTimeUpdate() {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }

  // Format values for display
  function formatTokenAmount(amount: string | bigint): string {
    const value = Number(amount) / 1e18; // Assuming 18 decimals
    return value.toFixed(4);
  }

  function formatTime(seconds: string | bigint): string {
    const totalSeconds = Number(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  return (
    <main className="min-h-screen bg-[#050505] text-white selection:bg-[#8338ec]/30 overflow-hidden relative">
      {/* Background Decor */}
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-[#8338ec]/10 rounded-full blur-[120px]" />
        <div className="absolute top-[40%] -right-[10%] w-[40%] h-[40%] bg-[#3a86ff]/10 rounded-full blur-[120px]" />
      </div>

      <div className="container mx-auto px-6 py-12 max-w-7xl relative z-10">
        {/* Header */}
        <header className="flex items-center justify-between mb-16">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl overflow-hidden shadow-lg shadow-purple-500/20">
              <img src="/logo.png" alt="TickPay Logo" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                TickPay
              </h1>
              <p className="text-xs text-gray-400 font-medium tracking-wide uppercase">Monad Streaming</p>
            </div>
          </div>

          {/* Wallet Connection */}
          <div className="flex items-center gap-4">
            {authenticated && (
              <div className="px-4 py-1.5 rounded-full text-xs font-semibold border backdrop-blur-md transition-colors bg-green-500/10 border-green-500/20 text-green-400">
                Monad Testnet
              </div>
            )}

            {authenticated && walletAddress ? (
              <div className="group relative flex items-center gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(walletAddress);
                    alert(`Address copied: ${walletAddress}`);
                  }}
                  className="bg-[#111] border border-white/10 hover:border-white/20 transition-colors px-5 py-2.5 rounded-xl flex items-center gap-3 cursor-pointer hover:bg-[#1a1a1a]"
                  title="Click to copy full address"
                >
                  <div className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.5)]"></div>
                  <span className="text-sm font-medium font-mono text-gray-200">
                    {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                  </span>
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
                <button
                  onClick={() => logout()}
                  className="text-xs text-gray-400 hover:text-white transition-colors"
                >
                  Logout
                </button>
              </div>
            ) : (
              <button
                onClick={handleConnectWallet}
                disabled={isLoading || !ready}
                className="relative overflow-hidden group bg-white text-black hover:bg-gray-100 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="relative z-10 flex items-center gap-2">
                  {isLoading || !ready ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      {!ready ? "Loading..." : "Connecting..."}
                    </>
                  ) : (
                    "Connect with Privy"
                  )}
                </span>
              </button>
            )}
          </div>
        </header>

        {/* Error Display */}
        {error && (
          <div className="mb-8 animate-fade-in bg-red-500/10 border border-red-500/20 text-red-200 px-6 py-4 rounded-xl flex items-center gap-3">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-medium">{error}</span>
          </div>
        )}

        {/* Existing Delegation Warning Modal */}
        {showDelegationWarning && existingDelegation && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-[#111] border border-white/10 rounded-2xl p-6 max-w-md mx-4 shadow-2xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-yellow-500/20 rounded-lg text-yellow-400">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-white">Existing Delegation Found</h3>
              </div>

              <p className="text-gray-300 text-sm mb-4">
                Your wallet already has an active EIP-7702 delegation. You need to revoke it before starting a new session.
              </p>

              <div className="bg-black/30 rounded-lg p-3 mb-6">
                <p className="text-xs text-gray-400 mb-1">Current delegate contract:</p>
                <p className="font-mono text-xs text-purple-400 break-all">{existingDelegation}</p>
                {existingDelegation.toLowerCase() === NEXT_PUBLIC_LOGIC_CONTRACT.toLowerCase() && (
                  <p className="text-xs text-green-400 mt-2">✓ This is the TickPay contract</p>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowDelegationWarning(false);
                    setExistingDelegation(null);
                  }}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setShowDelegationWarning(false);
                    // If it's the same contract, user might just want to continue
                    if (existingDelegation.toLowerCase() === NEXT_PUBLIC_LOGIC_CONTRACT.toLowerCase()) {
                      // Skip delegation check and proceed
                      setExistingDelegation(null);
                      handleStartWatching(true);
                    } else {
                      // Different contract - need to revoke first
                      setError("Please revoke the existing delegation in your wallet settings first, or stop the previous session.");
                      setExistingDelegation(null);
                    }
                  }}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-400 hover:to-blue-400 text-white text-sm font-bold transition-all"
                >
                  {existingDelegation.toLowerCase() === NEXT_PUBLIC_LOGIC_CONTRACT.toLowerCase()
                    ? "Continue Anyway"
                    : "I Understand"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Grid */}
        <div className="grid lg:grid-cols-12 gap-8 lg:gap-12">

          {/* Left Column: Video Player */}
          <div className="lg:col-span-8 space-y-6">
            <div className="group relative rounded-2xl overflow-hidden bg-[#111] border border-white/5 shadow-2xl shadow-black/50">
              {/* Glow effect behind player */}
              <div className="absolute -inset-1 bg-gradient-to-r from-[#8338ec] to-[#3a86ff] opacity-20 blur-xl group-hover:opacity-30 transition-opacity duration-500 pointer-events-none" />

              <div className="relative aspect-video bg-black">
                <video
                  ref={videoRef}
                  className={`w-full h-full object-contain ${!isCorrectChain ? 'opacity-50' : ''}`}
                  controls={isCorrectChain}
                  onPlay={handleVideoPlay}
                  onPause={handleVideoPause}
                  onEnded={handleVideoEnded}
                  onTimeUpdate={handleTimeUpdate}
                  poster="https://peach.blender.org/wp-content/uploads/title_anouncement.jpg?x11217"
                >
                  <source
                    src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
                    type="video/mp4"
                  />
                  Your browser does not support the video tag.
                </video>

                {/* Network Error Overlay */}
                {walletAddress && !isCorrectChain && (
                   <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-10">
                      <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl backdrop-blur-md">
                        <p className="text-red-400 font-semibold flex items-center gap-2">
                           <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                           </svg>
                           Wrong Network
                        </p>
                        <p className="text-sm text-gray-300 mt-1">Please switch to Monad Testnet</p>
                      </div>
                   </div>
                )}

                {/* Live Indicator */}
                {activeSessionId && (
                  <div className="absolute top-6 left-6 flex items-center gap-2 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                    </span>
                    <span className="text-xs font-bold tracking-wide uppercase text-white">Billing Active</span>
                  </div>
                )}
              </div>

              {/* Video Controls / Info Bar */}
              <div className="p-6 bg-[#111] border-t border-white/5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-white mb-1">Big Buck Bunny</h2>
                    <p className="text-sm text-gray-400">Open Source • 1080p • 60fps</p>
                  </div>

                  {walletAddress && isCorrectChain && (
                    <div className="flex-shrink-0">
                      {!activeSessionId ? (
                        <button
                          onClick={() => handleStartWatching()}
                          disabled={isLoading}
                          className="w-full sm:w-auto bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-white px-6 py-2.5 rounded-lg font-bold text-sm shadow-lg shadow-green-900/20 transition-all flex items-center justify-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                          </svg>
                          {isLoading ? "Initializing..." : "Start & Pay"}
                        </button>
                      ) : (
                        <button
                          onClick={handleStopWatching}
                          disabled={isLoading}
                          className="w-full sm:w-auto bg-[#222] hover:bg-[#333] border border-white/10 text-white px-6 py-2.5 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2"
                        >
                          <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                          </svg>
                          {isLoading ? "Stopping..." : "Stop Watching"}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Progress Bar Visual */}
                <div className="mt-6 h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
                   <div
                    className="h-full bg-gradient-to-r from-[#8338ec] to-[#3a86ff]"
                    style={{
                      width: videoRef.current
                        ? `${(currentTime / videoRef.current.duration) * 100}%`
                        : "0%",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Stats & Info */}
          <div className="lg:col-span-4 space-y-6">

            {/* Token Faucet Card */}
            {authenticated && walletAddress && (
              <div className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 backdrop-blur-xl border border-purple-500/20 rounded-2xl p-6 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-bold text-lg">TICK Faucet</h3>
                      <p className="text-xs text-gray-400">Get test tokens</p>
                    </div>
                  </div>
                  {tokenBalance && (
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Balance</p>
                      <p className="text-lg font-bold text-purple-400">{tokenBalance} <span className="text-xs">TICK</span></p>
                    </div>
                  )}
                </div>

                <button
                  onClick={handleFaucet}
                  disabled={isFaucetLoading}
                  className="w-full bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-400 hover:to-blue-400 disabled:from-gray-600 disabled:to-gray-600 text-white px-6 py-3 rounded-xl font-bold text-sm shadow-lg shadow-purple-900/20 transition-all flex items-center justify-center gap-2"
                >
                  {isFaucetLoading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Minting...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      Get 10 TICK Tokens
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Stats Card */}
            <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h3 className="font-bold text-lg">Billing Session</h3>
              </div>

              {activeSessionId && sessionStatus ? (
                <div className="space-y-6">
                  <div className="flex flex-col gap-1">
                     <span className="text-xs text-gray-400 uppercase tracking-wider">Session ID</span>
                     <span className="font-mono text-xs text-gray-300 break-all">{activeSessionId}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-black/20 border border-white/5">
                      <span className="text-xs text-gray-400 block mb-1">Time</span>
                      <span className="text-xl font-bold font-mono text-white">
                        {formatTime(sessionStatus.chargedSeconds)}
                      </span>
                    </div>
                    <div className="p-4 rounded-xl bg-black/20 border border-white/5">
                      <span className="text-xs text-gray-400 block mb-1">Cost</span>
                      <span className="text-xl font-bold font-mono text-[#8338ec]">
                        {formatTokenAmount(sessionStatus.chargedAmount)}
                        <span className="text-xs ml-1 text-gray-500">TICK</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm py-3 border-t border-white/5">
                    <span className="text-gray-400">Status</span>
                    <span className={`px-2 py-1 rounded text-xs font-bold ${
                      sessionStatus.closed
                        ? "bg-red-500/20 text-red-400"
                        : "bg-green-500/20 text-green-400"
                    }`}>
                      {sessionStatus.closed ? "CLOSED" : "STREAMING"}
                    </span>
                  </div>

                  <div className="text-xs text-center text-gray-500">
                    Rate: 0.001 TICK / second
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
                    <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-gray-400 font-medium">No Active Session</p>
                  <p className="text-xs text-gray-600 mt-2 max-w-[200px] mx-auto">Start watching the video to begin real-time billing via EIP-7702</p>
                </div>
              )}
            </div>

            {/* Steps / Info */}
            <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
              <h3 className="font-bold text-lg mb-4 text-gray-200">How It Works</h3>
              <ul className="space-y-4">
                {[
                  "Connect Wallet (Monad Testnet)",
                  "Approve EIP-7702 Delegation",
                  "Stream & Pay Per Second",
                  "Stop to Revoke Access"
                ].map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm text-gray-400 items-start">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-white mt-0.5">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Tech Stack Chips */}
             <div className="flex flex-wrap gap-2">
                {["EIP-7702", "Monad", "Viem", "Next.js 15"].map((tech) => (
                  <span key={tech} className="px-3 py-1 rounded-full bg-[#8338ec]/10 border border-[#8338ec]/20 text-[#8338ec] text-xs font-medium">
                    {tech}
                  </span>
                ))}
              </div>

          </div>
        </div>

        {/* Footer */}
        <footer className="mt-20 border-t border-white/5 pt-8 text-center">
          <p className="text-sm text-gray-500 mb-2">
            Built with <span className="text-white font-medium">EIP-7702 Account Abstraction</span> on Monad
          </p>
          <p className="text-xs text-gray-600 font-mono">
            Contract: {NEXT_PUBLIC_LOGIC_CONTRACT}
          </p>
        </footer>
      </div>
    </main>
  );
}
