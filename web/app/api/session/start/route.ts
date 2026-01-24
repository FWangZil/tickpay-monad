import { NextRequest, NextResponse } from "next/server";

const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL || "http://localhost:3001";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userAddress, signature, userPrivateKey, policyId } = body;

    if (!userAddress || !signature) {
      return NextResponse.json(
        { error: "userAddress and signature are required" },
        { status: 400 }
      );
    }

    // Forward request to relayer
    const response = await fetch(`${RELAYER_URL}/api/session/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userAddress, signature, userPrivateKey, policyId }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || "Failed to start session", details: data.details },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in start session API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
