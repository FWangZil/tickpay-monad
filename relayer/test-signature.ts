import { createPublicClient, http, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const userAddress = "0x24F03a9970ECdA87249ac054A48C79857aaB186b";
const chainId = 10143;

// Test domain with user address as verifyingContract
const domain = {
  name: "TickPay",
  version: "1",
  chainId,
  verifyingContract: userAddress as `0x${string}`,
};

const types = {
  SessionRequest: [
    { name: "user", type: "address" },
    { name: "policyId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

const message = {
  user: userAddress,
  policyId: 0n,
  nonce: 0n,
  deadline: 1769259235n,
};

// Test signature from logs
const signature = "0x4362db004e259766fb4de5356add7eb43f71b4f919df2bdaa0280eeedf4435672e0a9dbf22541325b46b3b88a614d680af3f405eca9734e4aeabc0f8bed87fab1b";

async function testSignature() {
  try {
    const recoveredAddress = await recoverTypedDataAddress({
      domain,
      types,
      primaryType: "SessionRequest",
      message,
      signature: signature as `0x${string}`,
    });

    console.log("Expected signer:", userAddress);
    console.log("Recovered signer:", recoveredAddress);
    console.log("Match:", recoveredAddress.toLowerCase() === userAddress.toLowerCase());
  } catch (error) {
    console.error("Error:", error);
  }
}

testSignature();
