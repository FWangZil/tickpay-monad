import type { Request, Response } from "express";
import { type Address, parseEther } from "viem";
import { walletClient, publicClient, config } from "../client.js";

// MockERC20 mint ABI
const MOCK_ERC20_MINT_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// Faucet amount: 10 TICK tokens
const FAUCET_AMOUNT = parseEther("10");

/**
 * POST /api/faucet
 * Mint 10 TICK tokens to the specified address
 */
export async function faucetHandler(req: Request, res: Response): Promise<void> {
  try {
    const { address } = req.body;

    if (!address) {
      res.status(400).json({ error: "address is required" });
      return;
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      res.status(400).json({ error: "Invalid address format" });
      return;
    }

    const userAddress = address as Address;

    // Get balance before
    const balanceBefore = await publicClient.readContract({
      address: config.TOKEN,
      abi: MOCK_ERC20_MINT_ABI,
      functionName: "balanceOf",
      args: [userAddress],
    }) as bigint;

    // Mint tokens
    const txHash = await walletClient.writeContract({
      address: config.TOKEN,
      abi: MOCK_ERC20_MINT_ABI,
      functionName: "mint",
      args: [userAddress, FAUCET_AMOUNT],
    });

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    // Get balance after
    const balanceAfter = await publicClient.readContract({
      address: config.TOKEN,
      abi: MOCK_ERC20_MINT_ABI,
      functionName: "balanceOf",
      args: [userAddress],
    }) as bigint;

    console.log(`[Faucet] Minted 10 TICK to ${userAddress}, txHash: ${txHash}`);

    res.json({
      success: true,
      txHash,
      amount: "10",
      token: config.TOKEN,
      balanceBefore: balanceBefore.toString(),
      balanceAfter: balanceAfter.toString(),
    });
  } catch (error) {
    console.error("Error in faucet:", error);
    const message = (error as Error).message || "Failed to mint tokens";
    res.status(500).json({ error: message });
  }
}
