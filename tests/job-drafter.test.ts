import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiClient, AiClientResult, AiConfig } from "@/lib/ai";
import { jobDrafterFor } from "@/lib/job-drafter";
import { JobPostingError } from "@/lib/job-postings";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
const NOW = new Date("2026-11-18T10:00:00Z");
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const config = (overrides: Partial<AiConfig> = {}): AiConfig => ({ apiKey: "sk-test", model: "gpt-4.1-mini", enabled: { "job-draft": true, suggestions: true }, limits: { "job-draft": 20, suggestions: 60 }, budget: null, ...overrides });

const draftOutput = (overrides: Record<string, unknown> = {}) => ({
  summary: "Help us cook, jar and pack Ube Jam.",
  responsibilities: ["Wash and peel yams", "Cook and blend the jam", "Jar and label each batch", "Keep the kitchen clean"],
  qualifications: ["Comfortable on your feet", "Follows recipes precisely", "Can lift 20 kg"],
  benefits: [],
  ...overrides,
});
const reply = (output: unknown): AiClientResult => ({ ok: true, output, inputTokens: 100, outputTokens: 50 });
const answers = (...results: AiClientResult[]) => {
  const calls: Parameters<AiClient>[0][] = [];
  const client: AiClient = async (request) => { calls.push(request); return results[Math.min(calls.length - 1, results.length - 1)]; };
  return Object.assign(client, { calls });
};
const drafter = (client: AiClient, options: { handle?: string; config?: AiConfig } = {}) =>
  jobDrafterFor(options.handle ?? handle, { db, client, config: options.config ?? config(), now: () => NOW });
const request = { title: "Production Assistant", department: "Kitchen", employmentType: "Full-time", location: "Quezon City", notes: "Hands-on, small-batch kitchen." };
const usage = async () => (await db.query<Record<string, unknown>>(`SELECT * FROM hrms_ai_usage ORDER BY id`)).rows;
const count = async (table: string) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);

beforeEach(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(name, directory), "utf8"));
  portal = new FakePortal();
  handle = portal.signIn(staff, ["Job Postings"]);
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => { if (!db.closed) await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const refused = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(JobPostingError);
  return (error as JobPostingError).reason;
};

describe("access", () => {
  it("is the Job Postings Module and nothing else: Staff without it are denied before any AI call", async () => {
    const client = answers(reply(draftOutput()));
    const other = portal.signIn({ ...staff, id: "u-bo", username: "bo" }, ["Applications", "Performance"]);
    expect(await refused(drafter(client, { handle: other }).draft(request))).toBe("denied");
    expect(await refused(drafter(client, { handle: other }).status())).toBe("denied");
    expect(client.calls).toHaveLength(0);
    expect(await usage()).toEqual([]);
  });
  it("sends a lapsed or missing session to sign-in, and says so when the Portal cannot answer", async () => {
    const client = answers(reply(draftOutput()));
    expect(await refused(drafter(client, { handle: "nope" }).draft(request))).toBe("invalid");
    expect(await refused(jobDrafterFor(undefined, { db, client, config: config(), now: () => NOW }).draft(request))).toBe("invalid");
    portal.unavailable = true;
    expect(await refused(drafter(client).draft(request))).toBe("unavailable");
    expect(client.calls).toHaveLength(0);
  });
  it("asks the Portal anew each time, so revoking the Module takes effect at once", async () => {
    const client = answers(reply(draftOutput()));
    const first = jobDrafterFor(handle, { db, client, config: config(), now: () => NOW });
    expect((await first.draft(request)).ok).toBe(true);
    const revoked = portal.signIn({ ...staff, id: "u-ada" }, []);
    expect(await refused(drafter(client, { handle: revoked }).draft(request))).toBe("denied");
  });
});

describe("validating the request", () => {
  it("returns field errors and calls nothing when the title is missing or the notes are too long", async () => {
    const client = answers(reply(draftOutput()));
    expect(await drafter(client).draft({ ...request, title: " " })).toEqual({ ok: false, kind: "invalid", fieldErrors: { title: "Enter a job title." } });
    expect(await drafter(client).draft({ ...request, notes: "a".repeat(1001) })).toMatchObject({ ok: false, kind: "invalid", fieldErrors: { notes: expect.stringContaining("1,000") } });
    expect(client.calls).toHaveLength(0);
    expect(await usage()).toEqual([]);
  });
  it("sends the cleaned notes, not the raw ones", async () => {
    const client = answers(reply(draftOutput()));
    await drafter(client).draft({ ...request, notes: "  Hands-on.   \r\n\r\n\r\n\r\nSmall batch.  " });
    expect(client.calls[0].user).toContain('"""\nHands-on.\n\nSmall batch.\n"""');
  });
});

describe("a draft", () => {
  it("returns the four fields, cleaned, with no warnings and the drafts left today", async () => {
    const client = answers(reply(draftOutput({ responsibilities: ["1. Wash and peel yams", "- Cook and blend the jam", "**Jar** and label each batch", "• Keep the kitchen clean"] })));
    const result = await drafter(client).draft(request);
    expect(result).toMatchObject({ ok: true, warnings: [], draftsLeft: 19, draft: { summary: "Help us cook, jar and pack Ube Jam.", responsibilities: ["Wash and peel yams", "Cook and blend the jam", "Jar and label each batch", "Keep the kitchen clean"], qualifications: ["Comfortable on your feet", "Follows recipes precisely", "Can lift 20 kg"], benefits: [] } });
    expect(client.calls).toHaveLength(1);
  });
  it("returns benefits only when the notes mention them", async () => {
    const withBenefits = draftOutput({ benefits: ["Free uniform", "HMO"] });
    expect(await drafter(answers(reply(withBenefits))).draft({ ...request, notes: "Offers free uniform and HMO." })).toMatchObject({ ok: true, draft: { benefits: ["Free uniform", "HMO"] } });
    expect(await drafter(answers(reply(withBenefits))).draft({ ...request, notes: "Hands-on kitchen role." })).toMatchObject({ ok: true, draft: { benefits: [] } });
  });
  it("reports the status for the dialog: drafts left today, and the limit", async () => {
    expect(await drafter(answers()).status()).toEqual({ enabled: true, draftsLeft: 20, limit: 20 });
    await drafter(answers(reply(draftOutput()))).draft(request);
    expect(await drafter(answers()).status()).toEqual({ enabled: true, draftsLeft: 19, limit: 20 });
  });
  it("writes nothing but the usage row: no posting, no template, no audit event", async () => {
    const before = { postings: await count("job_postings"), templates: await count("job_templates"), audit: await count("hrms_audit_outbox") };
    await drafter(answers(reply(draftOutput()))).draft(request);
    expect({ postings: await count("job_postings"), templates: await count("job_templates"), audit: await count("hrms_audit_outbox") }).toEqual(before);
    expect(await usage()).toMatchObject([{ staff_id: "u-ada", feature: "job-draft", outcome: "success", input_tokens: 100, output_tokens: 50 }]);
  });
  it("keeps the prompt, the notes and the draft out of the usage log", async () => {
    await drafter(answers(reply(draftOutput({ summary: "SECRET-DRAFT-TEXT" })))).draft({ ...request, notes: "SECRET-NOTES-TEXT" });
    const logged = JSON.stringify(await usage()) + JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    for (const text of ["SECRET-DRAFT-TEXT", "SECRET-NOTES-TEXT", "Production Assistant"]) expect(logged).not.toContain(text);
  });
});

describe("regenerating", () => {
  it("regenerates once when the first answer fails the schema, and uses the second", async () => {
    const client = answers(reply({ summary: "only a summary" }), reply(draftOutput()));
    expect(await drafter(client).draft(request)).toMatchObject({ ok: true, draftsLeft: 19 });
    expect(client.calls).toHaveLength(2);
    expect(await usage()).toMatchObject([{ outcome: "success", input_tokens: 200, output_tokens: 100 }]);
  });
  it("regenerates once when the first draft is flagged, and returns the clean second draft with no warnings", async () => {
    const flagged = draftOutput({ qualifications: ["Female applicants preferred", "Follows recipes", "Can lift 20 kg"] });
    const client = answers(reply(flagged), reply(draftOutput()));
    expect(await drafter(client).draft(request)).toMatchObject({ ok: true, warnings: [] });
    expect(client.calls).toHaveLength(2);
  });
  it("shows a draft that is still flagged after the retry, with the phrase, so HR can edit and use it (Needs a look)", async () => {
    const flagged = draftOutput({ qualifications: ["Female applicants preferred", "Follows recipes", "Can lift 20 kg"] });
    const client = answers(reply(flagged));
    const result = await drafter(client).draft(request);
    expect(client.calls).toHaveLength(2);
    expect(result).toMatchObject({ ok: true, warnings: [{ phrase: "Female applicants", category: "gender", field: "qualifications" }] });
  });
  it("returns the unusable outcome (AI-0093) after two schema failures, with a Reference ID that is in the usage log, and still uses a slot", async () => {
    const client = answers(reply({ nope: true }));
    const result = await drafter(client).draft(request);
    expect(client.calls).toHaveLength(2);
    expect(result).toMatchObject({ ok: false, kind: "ai", draftsLeft: 19, failure: { banner: "red", message: "The AI draft couldn't be used. Please try again or write it yourself." } });
    const referenceId = (result as { failure: { referenceId: string } }).failure.referenceId;
    expect(referenceId).toMatch(/^[A-Z0-9]{6}$/);
    expect(await usage()).toMatchObject([{ outcome: "unusable", error_code: "AI-0093", reference_id: referenceId, counts_toward_limit: true }]);
  });
  it("does not accept a first flagged draft that is followed by an unusable second answer", async () => {
    const flagged = draftOutput({ qualifications: ["Female applicants preferred", "Follows recipes", "Can lift 20 kg"] });
    const result = await drafter(answers(reply(flagged), reply({ nope: true }))).draft(request);
    expect(result).toMatchObject({ ok: false, failure: { banner: "red" } });
  });
  it("never checks HR's own text: a title or notes with a flagged phrase do not trigger a regenerate", async () => {
    const client = answers(reply(draftOutput()));
    const result = await drafter(client).draft({ ...request, notes: "Female applicants preferred, single, 21 to 30 years old" });
    expect(result).toMatchObject({ ok: true, warnings: [] });
    expect(client.calls).toHaveLength(1);
  });
});

describe("limits, switches and failures", () => {
  it("lets the 20th draft succeed and refuses the 21st with AI-0089, and a refused request does not count", async () => {
    for (let i = 0; i < 20; i += 1) expect((await drafter(answers(reply(draftOutput()))).draft(request)).ok).toBe(true);
    const client = answers(reply(draftOutput()));
    const result = await drafter(client).draft(request);
    expect(result).toMatchObject({ ok: false, kind: "ai", draftsLeft: 0, failure: { banner: "yellow", referenceId: null, message: "You've used all 20 AI drafts today. The limit resets at 12:00 AM Manila time. You can still write the posting yourself." } });
    expect(client.calls).toHaveLength(0);
  });
  it("refuses with AI-0094 when the drafter is switched off, and with AI-0090 when the company cap is reached", async () => {
    const off = await drafter(answers(reply(draftOutput())), { config: config({ enabled: { "job-draft": false, suggestions: true } }) }).draft(request);
    expect(off).toMatchObject({ ok: false, failure: { banner: "none", message: null, referenceId: null } });
    await drafter(answers(reply(draftOutput())), { config: config({ budget: 1 }) }).draft(request);
    expect(await drafter(answers(reply(draftOutput())), { config: config({ budget: 1 }) }).draft(request)).toMatchObject({ ok: false, failure: { banner: "yellow", referenceId: null } });
  });
  it("turns a provider failure into the busy message with a Reference ID, and gives the slot back", async () => {
    const result = await drafter(answers({ ok: false, reason: "provider-quota" })).draft(request);
    expect(result).toMatchObject({ ok: false, draftsLeft: 20, failure: { banner: "red", message: "The AI service is busy. Please try again in a moment." } });
    expect(JSON.stringify(result)).not.toMatch(/quota|billing|AI-\d{4}|provider/i);
    expect(await usage()).toMatchObject([{ error_reason: "provider-quota", counts_toward_limit: false }]);
  });
  it("returns AI-0092 when the call times out", async () => {
    expect(await drafter(answers({ ok: false, reason: "timeout" })).draft(request)).toMatchObject({ ok: false, failure: { message: "That took too long. Please try again." } });
  });
  it("sends the screen only the banner, the message and the Reference ID: no internal code or reason", async () => {
    for (const result of [answers({ ok: false, reason: "provider-quota" }), answers(reply({ nope: true })), answers({ ok: false, reason: "timeout" })]) {
      const outcome = await drafter(result).draft(request);
      expect(outcome.ok === false && outcome.kind === "ai" ? Object.keys(outcome.failure).sort() : []).toEqual(["banner", "message", "referenceId"]);
      expect(JSON.stringify(outcome)).not.toMatch(/AI-\d{4}|"code"|"reason"/);
    }
  });
  it("never puts an internal code in a message", async () => {
    for (const result of [{ ok: false, reason: "timeout" }, { ok: false, reason: "provider-rate-limit" }, { nope: true }] as const) {
      const outcome = await drafter(answers("ok" in result ? (result as AiClientResult) : reply(result))).draft(request);
      expect(outcome.ok === false && outcome.kind === "ai" ? (outcome.failure.message ?? "") : "").not.toMatch(/AI-\d{4}/);
    }
  });
});
