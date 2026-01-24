"use client";

import { Agentation } from "agentation";

export function AgentationWrapper() {
  // Only render in development environment to avoid shipping to production
  if (process.env.NODE_ENV !== "development") {
    return null;
  }
  
  return <Agentation />;
}
