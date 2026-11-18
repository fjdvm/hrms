import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeFailure, draftsLeft, readAiConfig, runAi, type AiClient, type AiClientResult, type AiConfig, type AiFeature, type AiReason } from "@/lib/ai";

let db: PGlite;
const NOW = new Date("2026-11-18T10:00:00Z"); // 6:00 PM in Manila
const config = (overrides: Partial<AiConfig> = {}): AiConfig => ({ apiKey: "sk-test-key", model: "gpt-4.1-mini", enabled: { "job-draft": true, suggestions: true }, limits: { "job-draft": 20, suggestions: 60 }, budget: null, ...overrides });
const good: AiClientResult = { ok: true, output: { summary: "ok" }, inputTokens: 120, outputTokens: 80 };
const answer = (...results: AiClientResult[]) => {
  const calls: unknown[] = [];
  const client: AiClient = async (request) => { calls.push(request); return results[Math.min(calls.length - 1, results.length - 1)]; };
  return Object.assign(client, { calls });
};
const request = { system: "SYSTEM-PROMPT-TEXT", user: "USER-NOTES-TEXT private note", schemaName: "draft", schema: { type: "object" } };
const parse = (output: unknown) => (typeof output === "object" && output && "summary" in output ? (output as { summary: string }) : null);
const run = (overrides: { staffId?: string; feature?: AiFeature; client?: AiClient; config?: AiConfig; at?: Date; parse?: (output: unknown) => unknown } = {}) =>
  runAi({ db, staffId: overrides.staffId ?? "u-ada", feature: overrides.feature ?? "job-draft", request, parse: (overrides.parse ?? parse) as typeof parse, client: overrides.client ?? answer(good), config: overrides.config ?? config(), now: () => overrides.at ?? NOW });
const rows = async () => (await db.query<Record<string, unknown>>(`SELECT * FROM hrms_ai_usage ORDER BY id`)).rows;
const failure = async (promise: ReturnType<typeof run>) => { const result = await promise; if (result.ok) throw new Error("expected a failure"); return result; };

beforeEach(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(name, directory), "utf8"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => { if (!db.closed) await db.close(); vi.restoreAllMocks(); });

describe("a successful request", () => {
  it("returns the parsed result and logs who, which feature and model, tokens and the outcome", async () => {
    const result = await run();
    expect(result).toEqual({ ok: true, value: { summary: "ok" } });
    expect(await rows()).toMatchObject([{ staff_id: "u-ada", feature: "job-draft", model: "gpt-4.1-mini", input_tokens: 120, output_tokens: 80, outcome: "success", error_code: null, reference_id: null, counts_toward_limit: true }]);
  });
  it("sends the configured model to the client", async () => {
    const client = answer(good);
    await run({ client, config: config({ model: "gpt-test" }) });
    expect(client.calls).toMatchObject([{ model: "gpt-test", schemaName: "draft" }]);
  });
});

describe("the per-user daily limit (AI-0089)", () => {
  it("lets the 20th request succeed and refuses the 21st with a yellow message, no code and no Reference ID", async () => {
    for (let i = 1; i <= 20; i += 1) expect((await run()).ok).toBe(true);
    const client = answer(good);
    const refused = await failure(run({ client }));
    expect(refused).toMatchObject({ code: "AI-0089", banner: "yellow", referenceId: null, message: "You've used all 20 AI drafts today. The limit resets at 12:00 AM Manila time. You can still write the posting yourself." });
    expect(client.calls).toHaveLength(0);
    expect((await rows()).at(-1)).toMatchObject({ outcome: "refused", error_code: "AI-0089", counts_toward_limit: false, reference_id: null });
  });
  it("counts each Staff member and each feature on their own", async () => {
    const small = config({ limits: { "job-draft": 1, suggestions: 1 } });
    expect((await run({ config: small })).ok).toBe(true);
    expect((await run({ config: small, staffId: "u-bea" })).ok).toBe(true);
    expect((await run({ config: small, feature: "suggestions" })).ok).toBe(true);
    expect((await failure(run({ config: small }))).code).toBe("AI-0089");
  });
  it("uses the feature's own limit and noun in the message", async () => {
    const small = config({ limits: { "job-draft": 20, suggestions: 1 } });
    await run({ config: small, feature: "suggestions" });
    expect((await failure(run({ config: small, feature: "suggestions" }))).message).toBe("You've used all 1 AI suggestions today. The limit resets at 12:00 AM Manila time. You can still flag development needs yourself.");
  });
  it("resets at Manila midnight, not UTC midnight", async () => {
    const small = config({ limits: { "job-draft": 2, suggestions: 60 } });
    const beforeMidnight = new Date("2026-11-18T15:59:59Z"); // 11:59:59 PM Manila
    const afterMidnight = new Date("2026-11-18T16:00:00Z"); // 12:00:00 AM Manila, 19 Nov
    await run({ config: small, at: new Date("2026-11-18T00:30:00Z") }); // 8:30 AM Manila: same Manila day as 15:59:59Z
    await run({ config: small, at: beforeMidnight });
    expect((await failure(run({ config: small, at: beforeMidnight }))).code).toBe("AI-0089");
    expect((await run({ config: small, at: afterMidnight })).ok).toBe(true);
    expect((await run({ config: small, at: afterMidnight })).ok).toBe(true);
    expect((await failure(run({ config: small, at: afterMidnight }))).code).toBe("AI-0089");
  });
  it("does not reset at UTC midnight (8:00 AM Manila)", async () => {
    const small = config({ limits: { "job-draft": 1, suggestions: 60 } });
    await run({ config: small, at: new Date("2026-11-17T20:00:00Z") }); // 4:00 AM Manila, 18 Nov
    expect((await failure(run({ config: small, at: new Date("2026-11-18T00:00:00Z") }))).code).toBe("AI-0089"); // UTC midnight: 8:00 AM Manila, still 18 Nov
  });
  it("reports the drafts left today", async () => {
    expect(await draftsLeft(db, "u-ada", "job-draft", config(), NOW)).toBe(20);
    await run(); await run();
    expect(await draftsLeft(db, "u-ada", "job-draft", config(), NOW)).toBe(18);
    expect(await draftsLeft(db, "u-ada", "job-draft", config(), new Date("2026-11-18T16:00:00Z"))).toBe(20);
  });
});

describe("two requests at the same moment", () => {
  it("never both take the last slot", async () => {
    const small = config({ limits: { "job-draft": 3, suggestions: 60 } });
    await run({ config: small }); await run({ config: small });
    const results = await Promise.all([run({ config: small }), run({ config: small })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toMatchObject([{ code: "AI-0089" }]);
    expect((await rows()).filter((r) => r.counts_toward_limit)).toHaveLength(3);
  });
  it("lets only the allowance through when many arrive together, for the Staff limit and the company cap", async () => {
    const many = await Promise.all(Array.from({ length: 8 }, () => run({ config: config({ limits: { "job-draft": 3, suggestions: 60 } }) })));
    expect(many.filter((r) => r.ok)).toHaveLength(3);
    const capped = await Promise.all(Array.from({ length: 8 }, (_, i) => run({ staffId: `u-${i}`, feature: "suggestions", config: config({ budget: 6 }) })));
    expect(capped.filter((r) => r.ok)).toHaveLength(3); // the budget counts the 3 from before (job-draft) too
  });
  it("reserves with a single statement: the check and the usage row are one call", async () => {
    const statements: string[] = [];
    const spy = { query: <T,>(sql: string, values?: unknown[]) => { statements.push(sql); return db.query<T>(sql, values); } };
    await runAi({ db: spy, staffId: "u-ada", feature: "job-draft", request, parse, client: answer(good), config: config(), now: () => NOW });
    expect(statements.filter((s) => /hrms_ai_reserve/.test(s))).toHaveLength(1);
    expect(statements.filter((s) => /^\s*SELECT\s+count/i.test(s))).toHaveLength(0);
  });
});

describe("failures that do not count (AI-0091, AI-0092)", () => {
  const cases: [string, AiClientResult, AiReason, string][] = [
    ["a provider rate limit", { ok: false, reason: "provider-rate-limit" }, "provider-rate-limit", "AI-0091"],
    ["a provider quota or billing error", { ok: false, reason: "provider-quota" }, "provider-quota", "AI-0091"],
    ["the provider being down", { ok: false, reason: "provider-unavailable" }, "provider-unavailable", "AI-0091"],
    ["the provider rejecting the request", { ok: false, reason: "provider-rejected" }, "provider-rejected", "AI-0091"],
    ["a call over 30 seconds", { ok: false, reason: "timeout" }, "timeout", "AI-0092"],
  ];
  it.each(cases)("%s returns %s as a red error with a Reference ID that matches the usage row, and uses no slot", async (_name, result, reason, code) => {
    const failed = await failure(run({ client: answer(result) }));
    expect(failed).toMatchObject({ code, banner: "red" });
    expect(failed.referenceId).toMatch(/^[A-Z0-9]{6}$/);
    expect((await rows())[0]).toMatchObject({ outcome: "failed", error_code: code, error_reason: reason, reference_id: failed.referenceId, counts_toward_limit: false });
    expect(await draftsLeft(db, "u-ada", "job-draft", config(), NOW)).toBe(20);
  });
  it("shows busy wording, never billing or quota wording, and logs the quota reason with the Reference ID", async () => {
    const failed = await failure(run({ client: answer({ ok: false, reason: "provider-quota" }) }));
    expect(failed.message).toBe("The AI service is busy. Please try again in a moment.");
    expect(failed.message).not.toMatch(/quota|billing|balance|credit/i);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("provider-quota"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(failed.referenceId!));
  });
  it("does not retry a provider failure", async () => {
    const client = answer({ ok: false, reason: "provider-unavailable" });
    await run({ client });
    expect(client.calls).toHaveLength(1);
  });
  it("lets the user go on to use all 20 after twenty provider failures", async () => {
    for (let i = 0; i < 25; i += 1) await run({ client: answer({ ok: false, reason: "timeout" }) });
    for (let i = 0; i < 20; i += 1) expect((await run()).ok).toBe(true);
    expect((await failure(run())).code).toBe("AI-0089");
  });
  it("reports a client that throws as a busy provider rather than failing", async () => {
    const failed = await failure(run({ client: async () => { throw new Error("boom"); } }));
    expect(failed.code).toBe("AI-0091");
  });
  it("uses the timeout message", async () => {
    expect((await failure(run({ client: answer({ ok: false, reason: "timeout" }) }))).message).toBe("That took too long. Please try again.");
  });
});

describe("an unusable result (AI-0093)", () => {
  it("regenerates once, then returns a red error that counts toward the limit", async () => {
    const client = answer({ ...good, output: { nope: true } });
    const failed = await failure(run({ client }));
    expect(client.calls).toHaveLength(2);
    expect(failed).toMatchObject({ code: "AI-0093", banner: "red", message: "The AI draft couldn't be used. Please try again or write it yourself." });
    expect(failed.referenceId).toMatch(/^[A-Z0-9]{6}$/);
    expect((await rows())[0]).toMatchObject({ outcome: "unusable", error_code: "AI-0093", counts_toward_limit: true, reference_id: failed.referenceId, input_tokens: 240, output_tokens: 160 });
    expect(await draftsLeft(db, "u-ada", "job-draft", config(), NOW)).toBe(19);
  });
  it("succeeds when the second try is usable, using one slot and both tries' tokens", async () => {
    const client = answer({ ...good, output: { nope: true } }, good);
    expect((await run({ client })).ok).toBe(true);
    expect(await rows()).toMatchObject([{ outcome: "success", input_tokens: 240, output_tokens: 160 }]);
    expect(await draftsLeft(db, "u-ada", "job-draft", config(), NOW)).toBe(19);
  });
  it("treats a provider answer with nothing usable like an unusable result", async () => {
    const client = answer({ ok: false, reason: "bad-response", inputTokens: 10, outputTokens: 0 });
    expect(await failure(run({ client }))).toMatchObject({ code: "AI-0093" });
    expect(client.calls).toHaveLength(2);
  });
  it("treats a validator that throws as unusable", async () => {
    expect(await failure(run({ parse: () => { throw new Error("bad"); } }))).toMatchObject({ code: "AI-0093" });
  });
  it("is a timeout (not counted) when the second try times out", async () => {
    const client = answer({ ...good, output: { nope: true } }, { ok: false, reason: "timeout" });
    expect(await failure(run({ client }))).toMatchObject({ code: "AI-0092" });
    expect(await draftsLeft(db, "u-ada", "job-draft", config(), NOW)).toBe(20);
  });
  it("uses the suggestions wording for suggestions", async () => {
    expect((await failure(run({ feature: "suggestions", client: answer({ ...good, output: {} }) }))).message).toBe("The AI suggestions couldn't be used. Please try again or flag a development need yourself.");
  });
});

describe("the company-wide cap (AI-0090)", () => {
  it("refuses with a yellow message and no Reference ID once the cap is reached, across Staff and features", async () => {
    const capped = config({ budget: 3 });
    await run({ config: capped, staffId: "u-1" }); await run({ config: capped, staffId: "u-2", feature: "suggestions" }); await run({ config: capped, staffId: "u-3" });
    const client = answer(good);
    const refused = await failure(run({ config: capped, staffId: "u-4", client }));
    expect(refused).toMatchObject({ code: "AI-0090", banner: "yellow", referenceId: null, message: "AI drafting is unavailable right now. Please try again tomorrow." });
    expect(client.calls).toHaveLength(0);
    expect((await rows()).at(-1)).toMatchObject({ outcome: "refused", error_code: "AI-0090", counts_toward_limit: false });
  });
  it("does not count refused or provider-failed calls toward the cap, and resets on the next Manila day", async () => {
    const capped = config({ budget: 2 });
    await run({ config: capped, client: answer({ ok: false, reason: "provider-quota" }) });
    await run({ config: capped, client: answer({ ok: false, reason: "timeout" }) });
    expect((await run({ config: capped, staffId: "u-1" })).ok).toBe(true);
    expect((await run({ config: capped, staffId: "u-2" })).ok).toBe(true);
    expect((await failure(run({ config: capped, staffId: "u-3" }))).code).toBe("AI-0090");
    expect((await run({ config: capped, staffId: "u-3", at: new Date("2026-11-18T16:00:00Z") })).ok).toBe(true);
  });
  it("says the Staff limit first when both are reached", async () => {
    const both = config({ budget: 1, limits: { "job-draft": 1, suggestions: 60 } });
    await run({ config: both });
    expect((await failure(run({ config: both }))).code).toBe("AI-0089");
  });
  it("has no cap when none is set", async () => {
    for (let i = 0; i < 25; i += 1) expect((await run({ staffId: `u-${i}` })).ok).toBe(true);
  });
});

describe("the on/off switches (AI-0094)", () => {
  it("refuses a disabled feature without calling the provider, with no message and no Reference ID", async () => {
    const client = answer(good);
    const off = config({ enabled: { "job-draft": false, suggestions: true } });
    expect(await failure(run({ config: off, client }))).toMatchObject({ code: "AI-0094", banner: "none", message: null, referenceId: null });
    expect(client.calls).toHaveLength(0);
    expect(await rows()).toMatchObject([{ outcome: "refused", error_code: "AI-0094", counts_toward_limit: false }]);
    expect((await run({ config: off, feature: "suggestions" })).ok).toBe(true);
  });
  it("does not use a slot", async () => {
    await run({ config: config({ enabled: { "job-draft": false, suggestions: true } }) });
    expect(await draftsLeft(db, "u-ada", "job-draft", config(), NOW)).toBe(20);
  });
});

describe("the map from a reason to a code, a message and a banner", () => {
  const reasons: AiReason[] = ["limit-reached", "budget-reached", "provider-rate-limit", "provider-quota", "provider-unavailable", "provider-rejected", "timeout", "unusable", "feature-off", "not-available"];
  it("follows docs/ai-error-codes.md", () => {
    const table = Object.fromEntries(reasons.map((r) => [r, [describeFailure(r, "job-draft", 20, "ABC234").code, describeFailure(r, "job-draft", 20, "ABC234").banner]]));
    expect(table).toEqual({
      "limit-reached": ["AI-0089", "yellow"], "budget-reached": ["AI-0090", "yellow"], "provider-rate-limit": ["AI-0091", "red"], "provider-quota": ["AI-0091", "red"],
      "provider-unavailable": ["AI-0091", "red"], "provider-rejected": ["AI-0091", "red"], timeout: ["AI-0092", "red"], unusable: ["AI-0093", "red"], "feature-off": ["AI-0094", "none"], "not-available": ["AI-0100", "grey"],
    });
  });
  it("carries a Reference ID only on red outcomes, and no message ever contains an internal code", () => {
    for (const feature of ["job-draft", "suggestions"] as const) {
      for (const reason of reasons) {
        const failed = describeFailure(reason, feature, 20, "ABC234");
        expect(failed.referenceId).toBe(failed.banner === "red" ? "ABC234" : null);
        expect(failed.message ?? "").not.toMatch(/AI-\d{4}|\bAI\d{4}\b/);
        expect(failed.message ?? "").not.toContain(failed.code);
      }
    }
  });
  it("words the grey Insufficient-data notice for suggestions only", () => {
    expect(describeFailure("not-available", "suggestions", 60).message).toBe("Suggestions aren't available for this evaluation: it has Insufficient data, so there are too few KPI results to suggest from.");
    expect(describeFailure("not-available", "job-draft", 20).message).toBeNull();
  });
  it("gives each red Reference ID a different random value that is stored once", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 15; i += 1) ids.add((await failure(run({ client: answer({ ok: false, reason: "timeout" }) }))).referenceId!);
    expect(ids.size).toBe(15);
    expect((await rows()).filter((r) => r.reference_id)).toHaveLength(15);
  });
});

describe("the usage log keeps no content", () => {
  it("holds no prompt text and no drafted text, on success or failure", async () => {
    await run({ client: answer({ ok: true, output: { summary: "DRAFTED-TEXT-SECRET" }, inputTokens: 1, outputTokens: 1 }) });
    await run({ client: answer({ ok: true, output: { nope: "DRAFTED-TEXT-SECRET" }, inputTokens: 1, outputTokens: 1 }) });
    await run({ client: answer({ ok: false, reason: "provider-unavailable" }) });
    const everything = JSON.stringify(await rows()) + JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    for (const text of ["SYSTEM-PROMPT-TEXT", "USER-NOTES-TEXT", "private note", "DRAFTED-TEXT-SECRET"]) expect(everything).not.toContain(text);
  });
  it("has no column that could hold text beyond the codes and a Reference ID", async () => {
    const { rows: columns } = await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'hrms_ai_usage' ORDER BY ordinal_position`);
    expect(columns.map((c) => c.column_name)).toEqual(["id", "staff_id", "feature", "model", "input_tokens", "output_tokens", "outcome", "error_code", "error_reason", "reference_id", "counts_toward_limit", "created_at", "usage_day"]);
  });
});

describe("settings", () => {
  it("uses the documented defaults", () => {
    expect(readAiConfig({})).toEqual({ apiKey: null, model: "gpt-4.1-mini", enabled: { "job-draft": true, suggestions: true }, limits: { "job-draft": 20, suggestions: 60 }, budget: null });
  });
  it("reads each setting, and ignores a bad number", () => {
    expect(readAiConfig({ OPENAI_API_KEY: " sk-x ", OPENAI_MODEL: "gpt-x", AI_JOB_DRAFTER_ENABLED: "false", AI_SUGGESTIONS_ENABLED: "off", AI_DAILY_LIMIT_JOB_DRAFT: "5", AI_DAILY_LIMIT_SUGGESTIONS: "-3", AI_DAILY_BUDGET: "200" }))
      .toEqual({ apiKey: "sk-x", model: "gpt-x", enabled: { "job-draft": false, suggestions: false }, limits: { "job-draft": 5, suggestions: 60 }, budget: 200 });
    expect(readAiConfig({ AI_DAILY_BUDGET: "abc" }).budget).toBeNull();
  });
});
