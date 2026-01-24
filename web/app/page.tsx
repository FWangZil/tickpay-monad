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
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#8338ec] to-[#3a86ff] flex items-center justify-center shadow-lg shadow-purple-500/20">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
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
            {chainId !== null && (
              <div className={`px-4 py-1.5 rounded-full text-xs font-semibold border backdrop-blur-md transition-colors ${
                isCorrectChain 
                  ? "bg-green-500/10 border-green-500/20 text-green-400" 
                  : "bg-red-500/10 border-red-500/20 text-red-400"
              }`}>
                {isCorrectChain ? "Monad Testnet" : `Chain ID: ${chainId}`}
              </div>
            )}

            {walletAddress ? (
              <div className="group relative">
                <div className="bg-[#111] border border-white/10 hover:border-white/20 transition-colors px-5 py-2.5 rounded-xl flex items-center gap-3 cursor-default">
                  <div className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_10px_rgba(74,222,128,0.5)]"></div>
                  <span className="text-sm font-medium font-mono text-gray-200">
                    {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                  </span>
                </div>
              </div>
            ) : (
              <button
                onClick={handleConnectWallet}
                disabled={isLoading}
                className="relative overflow-hidden group bg-white text-black hover:bg-gray-100 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="relative z-10 flex items-center gap-2">
                  {isLoading ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Connecting...
                    </>
                  ) : (
                    "Connect Wallet"
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

        {/* Main Grid */}
        <div className="grid lg:grid-cols-12 gap-8 lg:gap-12">
          
          {/* Left Column: Video Player */}
          <div className="lg:col-span-8 space-y-6">
            <div className="group relative rounded-2xl overflow-hidden bg-[#111] border border-white/5 shadow-2xl shadow-black/50">
              {/* Glow effect behind player */}
              <div className="absolute -inset-1 bg-gradient-to-r from-[#8338ec] to-[#3a86ff] opacity-20 blur-xl group-hover:opacity-30 transition-opacity duration-500" />
              
              <div className="relative aspect-video bg-black">
                <video
                  ref={videoRef}
                  className="w-full h-full object-contain"
                  controls
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
                          onClick={handleStartWatching}
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
