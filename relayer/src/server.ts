import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import { createSession } from "./api/create.js";
import { startSessionHandler } from "./api/start.js";
import { stopSessionHandler } from "./api/stop.js";
import { getSessionStatusHandler, getActiveSessionsHandler } from "./api/status.js";
import { faucetHandler } from "./api/faucet.js";

export function createServer(): Express {
  const app = express();

  // Middleware
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") || "http://localhost:3000",
    credentials: true,
  }));
  app.use(express.json());

  // Health check
  app.get("/health", (req: Request, res: Response) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "TickPay Relayer",
      version: "1.0.0",
    });
  });

  // API Routes
  app.post("/api/session/create", createSession);
  app.post("/api/session/start", startSessionHandler);
  app.post("/api/session/stop", stopSessionHandler);
  app.get("/api/session/status/:sessionId", getSessionStatusHandler);
  app.get("/api/sessions/active", getActiveSessionsHandler);

  // Faucet
  app.post("/api/faucet", faucetHandler);

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  // Error handler
  app.use((err: Error, req: Request, res: Response, next: unknown) => {
    console.error("Unhandled error:", err);
    res.status(500).json({
      error: "Internal server error",
      message: err.message,
    });
  });

  return app;
}
