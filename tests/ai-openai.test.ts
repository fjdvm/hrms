import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { AI_TIMEOUT_MS, createOpenAiClient } from "@/lib/ai";

const request = { model: "gpt-4.1-mini", system: "sys", user: "usr", schemaName: "draft", schema: { type: "object", properties: {}, additionalProperties: false } };
const reply = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const completion = (content: string, extra: Record<string, unknown> = {}) => ({ choices: [{ finish_reason: "stop", message: { content }, ...extra }], usage: { prompt_tokens: 11, completion_tokens: 7 } });
const client = (fetcher: typeof fetch, options: { apiKey?: string | null; timeoutMs?: number } = {}) => createOpenAiClient({ apiKey: "sk-test", fetch: fetcher, ...options });

describe("the OpenAI client", () => {
  it("is 30 seconds by default", () => expect(AI_TIMEOUT_MS).toBe(30_000));

  it("posts a structured JSON schema request with the key and returns the parsed output and token counts", async () => {
    const fetcher = vi.fn(async () => reply(200, completion('{"summary":"x"}')));
    const result = await client(fetcher as unknown as typeof fetch)(request);
    expect(result).toEqual({ ok: true, output: { summary: "x" }, inputTokens: 11, outputTokens: 7 });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "gpt-4.1-mini", messages: [{ role: "system", content: "sys" }, { role: "user", content: "usr" }], response_format: { type: "json_schema", json_schema: { name: "draft", strict: true, schema: request.schema } } });
  });

  it.each([
    ["a rate limit", 429, { error: { code: "rate_limit_exceeded", type: "requests" } }, "provider-rate-limit"],
    ["a quota error", 429, { error: { code: "insufficient_quota", type: "insufficient_quota" } }, "provider-quota"],
    ["a billing error", 402, { error: { message: "billing" } }, "provider-quota"],
    ["a server error", 503, { error: {} }, "provider-unavailable"],
    ["a bad key", 401, { error: { code: "invalid_api_key" } }, "provider-rejected"],
    ["a non-JSON error page", 502, "<html>Bad gateway</html>", "provider-unavailable"],
  ])("sorts %s into %s", async (_name, status, body, reason) => {
    expect(await client((async () => reply(status, body)) as typeof fetch)(request)).toEqual({ ok: false, reason });
  });

  it("reports a network failure as the provider being unavailable", async () => {
    expect(await client((async () => { throw new TypeError("fetch failed"); }) as typeof fetch)(request)).toEqual({ ok: false, reason: "provider-unavailable" });
  });

  it.each([
    ["a refusal", completion("", { message: { content: null, refusal: "no" } })],
    ["a cut-off answer", completion('{"summary":"x', { finish_reason: "length" })],
    ["invalid JSON", completion("not json")],
    ["no choices", { choices: [] }],
  ])("reports %s as a bad response", async (_name, body) => {
    expect(await client((async () => reply(200, body)) as typeof fetch)(request)).toMatchObject({ ok: false, reason: "bad-response" });
  });

  it("gives up and reports a timeout when the call is too slow, aborting the request", async () => {
    let aborted = false;
    const slow = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => { aborted = true; reject(new DOMException("aborted", "AbortError")); });
    })) as unknown as typeof fetch;
    expect(await client(slow, { timeoutMs: 20 })(request)).toEqual({ ok: false, reason: "timeout" });
    expect(aborted).toBe(true);
  });

  it("does not call out without a key", async () => {
    const fetcher = vi.fn();
    expect(await client(fetcher as unknown as typeof fetch, { apiKey: null })(request)).toEqual({ ok: false, reason: "provider-rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("the key stays on the server", () => {
  it("is never named in a NEXT_PUBLIC_ variable and lib/ai is not imported by a client component", async () => {
    const scan = async (directory: URL, hits: string[]) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".git")) continue;
        const target = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
        if (entry.isDirectory()) await scan(target, hits);
        else if (/\.(tsx?|mjs|md|example)$/.test(entry.name) && !entry.name.includes(".test.")) {
          const text = await readFile(target, "utf8");
          if (/NEXT_PUBLIC_OPENAI/.test(text)) hits.push(`${target.pathname}: NEXT_PUBLIC_OPENAI`);
          if (/^["']use client["']/.test(text) && /from ["']@\/lib\/ai(\/|["'])/.test(text)) hits.push(`${target.pathname}: client component imports lib/ai`);
        }
      }
    };
    const hits: string[] = [];
    for (const dir of ["../app/", "../components/", "../lib/", "../hooks/"]) await scan(new URL(dir, import.meta.url), hits);
    expect(hits).toEqual([]);
  });
});
