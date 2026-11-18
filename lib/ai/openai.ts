import type { AiReason } from "./messages";

/** The call timeout. Over this, the request is abandoned and reported as AI-0092. */
export const AI_TIMEOUT_MS = 30_000;

export type AiRequest = {
  model: string;
  system: string;
  user: string;
  /** A JSON Schema the answer must follow (OpenAI structured output). */
  schemaName: string;
  schema: Record<string, unknown>;
};

export type AiClientResult =
  | { ok: true; output: unknown; inputTokens: number; outputTokens: number }
  /** `bad-response`: the provider answered but with nothing usable (a refusal, a cut-off or invalid JSON). It reached the provider, so it still counts. */
  | { ok: false; reason: Extract<AiReason, "provider-rate-limit" | "provider-quota" | "provider-unavailable" | "provider-rejected" | "timeout"> | "bad-response"; inputTokens?: number; outputTokens?: number };

/** The seam the AI layer calls through. Production uses `createOpenAiClient`; tests pass a fake. */
export type AiClient = (request: AiRequest) => Promise<AiClientResult>;

type Options = { apiKey: string | null; fetch?: typeof fetch; timeoutMs?: number; url?: string };

const asNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** Sorts an HTTP error from OpenAI into a reason. A billing or quota error is told apart from a plain rate limit (both read "busy" to Staff). */
function classify(status: number, body: unknown): Extract<AiClientResult, { ok: false }>["reason"] {
  const error = (body as { error?: { code?: unknown; type?: unknown } } | null)?.error;
  const detail = `${String(error?.code ?? "")} ${String(error?.type ?? "")}`;
  if (status === 429) return /quota|billing/i.test(detail) ? "provider-quota" : "provider-rate-limit";
  if (status === 402) return "provider-quota";
  if (status >= 500 || status === 408 || status === 409) return "provider-unavailable";
  return "provider-rejected";
}

/** A plain `fetch` call to OpenAI's Chat Completions with structured JSON output. Returns the parsed result or a typed failure; it never throws. */
export function createOpenAiClient({ apiKey, fetch: fetcher = globalThis.fetch, timeoutMs = AI_TIMEOUT_MS, url = "https://api.openai.com/v1/chat/completions" }: Options): AiClient {
  return async (request) => {
    if (!apiKey) return { ok: false, reason: "provider-rejected" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: request.model,
          messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }],
          response_format: { type: "json_schema", json_schema: { name: request.schemaName, strict: true, schema: request.schema } },
        }),
      });
      // The body read is inside the timeout too: a response that stalls half-way is still too slow.
      const text = await response.text();
      let body: unknown = null;
      try { body = JSON.parse(text); } catch { /* handled below */ }
      if (!response.ok) return { ok: false, reason: classify(response.status, body) };
      const completion = body as { choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | null;
      const tokens = { inputTokens: asNumber(completion?.usage?.prompt_tokens), outputTokens: asNumber(completion?.usage?.completion_tokens) };
      const choice = completion?.choices?.[0];
      if (!choice || choice.finish_reason !== "stop" || choice.message?.refusal || typeof choice.message?.content !== "string") return { ok: false, reason: "bad-response", ...tokens };
      try {
        return { ok: true, output: JSON.parse(choice.message.content), ...tokens };
      } catch {
        return { ok: false, reason: "bad-response", ...tokens };
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return { ok: false, reason: "timeout" };
      return { ok: false, reason: "provider-unavailable" };
    } finally {
      clearTimeout(timer);
    }
  };
}
