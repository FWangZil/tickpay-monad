"use client";

import { useState, useEffect, useRef } from "react";
import {
  connectWallet,
  getWalletAddress,
  getChainId,
  switchToMonad,
  setupWalletListeners,
  NEXT_PUBLIC_LOGIC_CONTRACT,
} from "@/lib/viem";
import { signSessionRequest } from "@/lib/eip712";
import type { Session, Address } from "@/lib/types";

export default function Home() {
  // Wallet state
  const [walletAddress, setWalletAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isCorrectChain, setIsCorrectChain] = useState(false);

  // Session state
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Video state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // Polling interval ref
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Setup wallet listeners on mount
  useEffect(() => {
    const cleanup = setupWalletListeners({
      onAccountsChanged: (accounts) => {
        setWalletAddress(accounts[0] || null);
        if (activeSessionId) {
          stopActiveSession();
        }
      },
      onChainChanged: (chainId) => {
        setChainId(Number(chainId));
        if (activeSessionId) {
          stopActiveSession();
        }
      },
      onDisconnect: () => {
        setWalletAddress(null);
        setChainId(null);
        if (activeSessionId) {
          stopActiveSession();
        }
      },
    });

    // Check initial wallet state
    checkWalletState();

    return cleanup;
  }, []);

  // Check if we're on the correct chain
  useEffect(() => {
    setIsCorrectChain(chainId === 143); // Monad chain ID
  }, [chainId]);

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

  async function checkWalletState() {
    try {
      const address = await getWalletAddress();
      const chain = await getChainId();
      setWalletAddress(address);
      setChainId(chain);
    } catch (error) {
      console.error("Error checking wallet state:", error);
    }
  }

  async function handleConnectWallet() {
    try {
      setIsLoading(true);
      setError(null);

      const address = await connectWallet();
      const chain = await getChainId();

      setWalletAddress(address);
      setChainId(chain);

      // Prompt to switch to Monad if not on correct chain
      if (chain !== 143) {
        await switchToMonad();
        const newChain = await getChainId();
        setChainId(newChain);
      }
    } catch (error: any) {
      setError(error.message || "Failed to connect wallet");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleStartWatching() {
    if (!walletAddress) {
      setError("Please connect your wallet first");
      return;
    }

    if (!isCorrectChain) {
      setError("Please switch to Monad network");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Step 1: Create session (get EIP-712 data)
      const createResponse = await fetch("/api/session/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: walletAddress,
          policyId: 0, // Use default policy
        }),
      });

      const createData = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(createData.error || "Failed to create session");
      }

      // Step 2: Sign EIP-712 data
      const walletClient = (window as any).ethereum;
      const signature = await walletClient.request({
        method: "eth_signTypedData_v4",
        params: [walletAddress, JSON.stringify(createData.types)],
      });

      // Step 3: Start session (relayer sends delegation tx)
      const startResponse = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: walletAddress,
          signature,
          policyId: 0,
        }),
      });

      const startData = await startResponse.json();
      if (!startResponse.ok) {
        throw new Error(startData.error || "Failed to start session");
      }

      setActiveSessionId(startData.sessionId);

      // Start video playback
      if (videoRef.current) {
        videoRef.current.play();
      }
    } catch (error: any) {
      setError(error.message || "Failed to start session");
    } finally {
      setIsLoading(false);
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

      const response = await fetch("/api/session/stop", {
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
      const response = await fetch(`/api/session/status/${sessionId}`);
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
    if (!activeSessionId && walletAddress) {
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
  function formatTokenAmount(amount: string): string {
    const value = Number(amount) / 1e18; // Assuming 18 decimals
    return value.toFixed(4);
  }

  function formatTime(seconds: string): string {
    const totalSeconds = Number(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                TickPay
              </h1>
              <p className="text-gray-400 mt-2">Per-Second Video Billing on Monad</p>
            </div>

            {/* Wallet Connection */}
            <div className="flex items-center gap-4">
              {chainId !== null && (
                <div className={`px-3 py-1 rounded-full text-sm ${
                  isCorrectChain ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                }`}>
                  {isCorrectChain ? "Monad" : `Chain ${chainId}`}
                </div>
              )}

              {walletAddress ? (
                <div className="bg-gray-800 px-4 py-2 rounded-lg flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-400"></div>
                  <span className="text-sm font-mono">
                    {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                  </span>
                </div>
              ) : (
                <button
                  onClick={handleConnectWallet}
                  disabled={isLoading}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-6 py-2 rounded-lg font-medium transition-colors"
                >
                  {isLoading ? "Connecting..." : "Connect Wallet"}
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Error Display */}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Main Content */}
        <div className="grid md:grid-cols-2 gap-8">
          {/* Video Player */}
          <div className="bg-gray-800/50 rounded-xl overflow-hidden border border-gray-700">
            <div className="aspect-video bg-black relative">
              <video
                ref={videoRef}
                className="w-full h-full"
                controls
                onPlay={handleVideoPlay}
                onPause={handleVideoPause}
                onEnded={handleVideoEnded}
                onTimeUpdate={handleTimeUpdate}
              >
                <source
                  src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
                  type="video/mp4"
                />
                Your browser does not support the video tag.
              </video>

              {/* Session Overlay */}
              {activeSessionId && (
                <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-sm px-3 py-1 rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
                    <span className="text-sm">Billing Active</span>
                  </div>
                </div>
              )}
            </div>

            {/* Video Controls */}
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold">Big Buck Bunny</h3>
                  <p className="text-sm text-gray-400">Sample Video</p>
                </div>

                {walletAddress && isCorrectChain && (
                  <div className="flex gap-2">
                    {!activeSessionId ? (
                      <button
                        onClick={handleStartWatching}
                        disabled={isLoading}
                        className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                        </svg>
                        {isLoading ? "Starting..." : "Start Watching"}
                      </button>
                    ) : (
                      <button
                        onClick={handleStopWatching}
                        disabled={isLoading}
                        className="bg-red-600 hover:bg-red-700 disabled:bg-gray-600 px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75A.75.75 0 007.25 3h-1.5zM12.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5z" />
                        </svg>
                        {isLoading ? "Stopping..." : "Stop Watching"}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Progress Bar */}
              <div className="bg-gray-700 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-blue-500 to-purple-500 h-full transition-all duration-300"
                  style={{
                    width: videoRef.current
                      ? `${(currentTime / videoRef.current.duration) * 100}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Billing Info */}
          <div className="space-y-6">
            {/* Session Status Card */}
            <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Session Status
              </h2>

              {activeSessionId && sessionStatus ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center py-2 border-b border-gray-700">
                    <span className="text-gray-400">Session ID</span>
                    <span className="font-mono text-sm">{activeSessionId.slice(0, 12)}...</span>
                  </div>

                  <div className="flex justify-between items-center py-2 border-b border-gray-700">
                    <span className="text-gray-400">Status</span>
                    <span className={sessionStatus.closed ? "text-red-400" : "text-green-400"}>
                      {sessionStatus.closed ? "Closed" : "Active"}
                    </span>
                  </div>

                  <div className="flex justify-between items-center py-2 border-b border-gray-700">
                    <span className="text-gray-400">Time Watched</span>
                    <span className="font-semibold">{formatTime(sessionStatus.chargedSeconds)}</span>
                  </div>

                  <div className="flex justify-between items-center py-2 border-b border-gray-700">
                    <span className="text-gray-400">Amount Charged</span>
                    <span className="font-semibold text-purple-400">
                      {formatTokenAmount(sessionStatus.chargedAmount)} TICK
                    </span>
                  </div>

                  <div className="flex justify-between items-center py-2">
                    <span className="text-gray-400">Rate</span>
                    <span className="text-sm">0.001 TICK/second</span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p>No active session</p>
                  <p className="text-sm mt-2">Click "Start Watching" to begin billing</p>
                </div>
              )}
            </div>

            {/* How It Works */}
            <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
              <h2 className="text-xl font-semibold mb-4">How It Works</h2>
              <ol className="space-y-3 text-sm text-gray-300">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">1</span>
                  <span>Connect your wallet and switch to Monad network</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">2</span>
                  <span>Click "Start Watching" to authorize EIP-7702 delegation</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">3</span>
                  <span>Watch the video while being billed per-second</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">4</span>
                  <span>Click "Stop Watching" to revoke delegation</span>
                </li>
              </ol>
            </div>

            {/* Tech Stack */}
            <div className="bg-gradient-to-br from-purple-900/20 to-blue-900/20 rounded-xl p-6 border border-purple-500/30">
              <h3 className="text-sm font-semibold text-purple-300 mb-2">Powered By</h3>
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-1 bg-gray-800 rounded text-xs">EIP-7702</span>
                <span className="px-2 py-1 bg-gray-800 rounded text-xs">Monad</span>
                <span className="px-2 py-1 bg-gray-800 rounded text-xs">Viem</span>
                <span className="px-2 py-1 bg-gray-800 rounded text-xs">Foundry</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-12 text-center text-sm text-gray-500">
          <p>Built with EIP-7702 Account Abstraction on Monad Blockchain</p>
          <p className="mt-1">Contract: {NEXT_PUBLIC_LOGIC_CONTRACT}</p>
        </footer>
      </div>
    </main>
  );
}
