import { NextRequest, NextResponse } from "next/server";

const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL || "http://localhost:3001";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, userAddress, userPrivateKey } = body;

    if (!sessionId || !userAddress) {
      return NextResponse.json(
        { error: "sessionId and userAddress are required" },
        { status: 400 }
      );
    }

    // Forward request to relayer
    const response = await fetch(`${RELAYER_URL}/api/session/stop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionId, userAddress, userPrivateKey }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || "Failed to stop session", details: data.details },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in stop session API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
