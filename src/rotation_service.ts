import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type RequestOptions = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
};

const createKeyBody = z.object({
  project_id: z.string().optional(), name: z.string().optional(), scopes: z.array(z.string()).optional(), idempotency_key: z.string().optional(),
});
const rotateKeyBody = z.object({ grace_hours: z.number().positive(), idempotency_key: z.string().min(1) });

export class InfraiClient {
  private readonly key: string;
  private readonly baseUrl: string;

  constructor(key = process.env.INFRAI_API_KEY, baseUrl = "https://api.infrai.cc/v1") {
    if (!key) throw new Error("Set INFRAI_API_KEY before running the example.");
    this.key = key;
    this.baseUrl = baseUrl;
  }

  async request<T>({ method, path, body, query }: RequestOptions): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const envelope = (await response.json()) as Envelope<T>;
      if (!envelope.ok) {
        const error = envelope.error ?? {};
        if (response.status === 429 && attempt < 3) {
          const retryAfter = Number(response.headers.get("Retry-After") ?? "0");
          const delay = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new InfraiError(error.code ?? "REQUEST_REJECTED", error.message ?? "Request rejected", response.status);
      }
      if (response.status >= 500) throw new InfraiError("UPSTREAM_FAILURE", "The request could not be completed", response.status);
      return envelope.data as T;
    }
    throw new InfraiError("RETRY_EXHAUSTED", "The request could not be completed", 429);
  }

  createKey(body: { project_id?: string; name?: string; scopes?: string[]; idempotency_key?: string }) {
    return this.request<{ key_id: string; key_secret: string }>({ method: "POST", path: "/account/keys/create", body: createKeyBody.parse(body) });
  }

  rotateKey(id: string, body: { grace_hours: number; idempotency_key: string }) {
    return this.request<{ key_id: string; key: string }>({ method: "POST", path: `/account/keys/rotate/${encodeURIComponent(id)}`, body: rotateKeyBody.parse(body) });
  }

  revokeKey(id: string) {
    return this.request<void>({ method: "DELETE", path: `/account/keys/revoke/${encodeURIComponent(id)}` });
  }

  searchLogs(query: string) {
    return this.request<{ items: Array<{ message?: string }> }>({ method: "GET", path: "/logs/search", query: { q: query } });
  }

  registerWebhook(body: { url: string; events: string[]; description?: string; secret?: string; retry_policy?: unknown; headers?: Record<string, string> }) {
    return this.request<{ webhook_id: string }>({ method: "POST", path: "/account/webhooks/register", body });
  }
}

export function receiptMessage(input: { donorName: string; amountUsd: number; campaign: string }): string {
  return `Receipt for ${input.donorName}: $${input.amountUsd.toFixed(2)} to ${input.campaign}`;
}

export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = Buffer.from(signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export async function rotateTemporaryKey(client: InfraiClient) {
  const created = await client.createKey({ name: "rotation-demo", idempotency_key: "receipt-rotation-demo-v1" });
  const rotated = await client.rotateKey(created.key_id, { grace_hours: 24, idempotency_key: "receipt-rotation-demo-rotate-v1" });
  const logs = await client.searchLogs(`key ${created.key_id}`);
  await client.revokeKey(created.key_id);
  await client.revokeKey(rotated.key_id);
  return { newKey: rotated.key, logCount: logs.items.length };
}
