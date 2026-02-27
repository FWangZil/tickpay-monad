function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) {
    throw new Error("relayer baseUrl is required");
  }
  return String(baseUrl).replace(/\/+$/, "");
}

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, init);
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    const details = data?.details || data?.error || `HTTP ${response.status}`;
    const error = new Error(String(details));
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

/**
 * Build a small typed client for the TickPay relayer HTTP API.
 */
export function createRelayerHttpClient(baseUrl, options = {}) {
  const resolvedBaseUrl = normalizeBaseUrl(baseUrl);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("fetch implementation is required");
  }

  return {
    async createSession(input) {
      return requestJson(fetchImpl, `${resolvedBaseUrl}/api/session/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
    },

    async startSession(input) {
      return requestJson(fetchImpl, `${resolvedBaseUrl}/api/session/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
    },

    async stopSession(input) {
      return requestJson(fetchImpl, `${resolvedBaseUrl}/api/session/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
    },

    async getSessionStatus(sessionId) {
      return requestJson(fetchImpl, `${resolvedBaseUrl}/api/session/status/${sessionId}`, {
        method: "GET"
      });
    },

    async getActiveSessions() {
      return requestJson(fetchImpl, `${resolvedBaseUrl}/api/sessions/active`, {
        method: "GET"
      });
    },

    async faucet(input) {
      return requestJson(fetchImpl, `${resolvedBaseUrl}/api/faucet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
    }
  };
}
