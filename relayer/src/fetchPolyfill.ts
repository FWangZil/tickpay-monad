import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

type HeaderRecord = Record<string, string>;

function toHeaderRecord(headers: unknown): HeaderRecord {
  if (!headers || typeof headers !== "object") return {};
  if (Array.isArray(headers)) {
    const out: HeaderRecord = {};
    for (const [k, v] of headers as Array<[string, string]>) {
      out[String(k).toLowerCase()] = String(v);
    }
    return out;
  }
  const out: HeaderRecord = {};
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    out[k.toLowerCase()] = String(v);
  }
  return out;
}

export function ensureFetchPolyfill(): void {
  const g = globalThis as any;
  if (typeof g.fetch === "function") return;

  g.fetch = async (input: string | URL, init?: Record<string, any>) => {
    const url = typeof input === "string" ? new URL(input) : input;
    const isHttps = url.protocol === "https:";
    const req = isHttps ? httpsRequest : httpRequest;
    const method = (init?.method || "GET").toUpperCase();
    const headers = toHeaderRecord(init?.headers);
    const body = init?.body ? String(init.body) : undefined;

    const payload = await new Promise<{
      status: number;
      headers: HeaderRecord;
      body: string;
    }>((resolve, reject) => {
      const r = req(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on("end", () => {
            const outHeaders: HeaderRecord = {};
            for (const [k, v] of Object.entries(res.headers)) {
              if (Array.isArray(v)) outHeaders[k.toLowerCase()] = v.join(", ");
              else if (v !== undefined) outHeaders[k.toLowerCase()] = String(v);
            }
            resolve({
              status: res.statusCode || 500,
              headers: outHeaders,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );

      r.on("error", reject);
      if (body) r.write(body);
      r.end();
    });

    const response = {
      ok: payload.status >= 200 && payload.status < 300,
      status: payload.status,
      headers: {
        get(name: string) {
          return payload.headers[name.toLowerCase()] ?? null;
        },
      },
      text: async () => payload.body,
      json: async () => JSON.parse(payload.body),
    };

    return response;
  };
}
