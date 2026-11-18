import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftAsFormFields, parseDraft } from "@/lib/job-draft";
import { fieldsFromForm, splitRequirements } from "@/lib/job-posting-form";
import { jobPostingsFor } from "@/lib/job-postings";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

/**
 * The hand-off from an accepted AI draft to the Careers site, checked without running either app: the draft goes through the form's own
 * parsing, then the real save-as-Draft and Publish on an in-memory database, and the stored row is read the way Careers reads it. The
 * Careers side of the same contract (the saved text shows in the right sections, with no label line) is tested in brenraphaels-ecommerce
 * (`requirementItems`, fjdvm/brenraphaels-ecommerce#339). Nothing here touches the production database or publishes to real Applicants.
 */

const ada = { name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
let db: PGlite;
let handle: string;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE, job_alerts_opt_in boolean)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(name, directory), "utf8"));
  await db.exec(`CREATE SCHEMA IF NOT EXISTS neon_auth; CREATE TABLE IF NOT EXISTS neon_auth."user" (id text PRIMARY KEY, email text, "emailVerified" boolean);`);
  const portal = new FakePortal();
  handle = portal.signIn(ada, ["Job Postings"]);
  const portalBoundary = portalFetch(portal);
  vi.stubEnv("CAREERS_URL", "https://careers.test");
  vi.stubEnv("API_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("API_GATEWAY_KEY", "hrms-test-key");
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) =>
    String(input).startsWith("https://gateway.test") ? Response.json({ id: "accepted" }, { status: 201 }) : portalBoundary(input, init));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
});
afterEach(async () => { await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/** What the AI answers, as it often does: markdown, bullets and numbering. */
const aiAnswer = {
  summary: "**Run the till** at our Cainta branch, serving walk-in customers.",
  responsibilities: ["1. Greet customers and process sales", "- Count the cash drawer at closing", "* Keep the counter tidy", "• Answer questions about our products"],
  qualifications: ["- At least high school graduate", "2) Comfortable with basic math", "Available Monday to Saturday"],
  benefits: ["- Free meals on shift", "13th month pay"],
};
const NOTES = "Cashier. Free meals and 13th month pay.";

/** The accepted draft, as the form sends it: the four text fields from the draft, everything else as HR typed it. */
function acceptedDraftForm(extra: Record<string, string> = {}) {
  const draft = parseDraft(aiAnswer, NOTES);
  if (!draft) throw new Error("the fixture draft must be usable");
  const data = new FormData();
  const typed: Record<string, string> = { title: "Branch Cashier", department: "Retail", location: "Cainta branch", employmentType: "Part-time", ...extra };
  for (const [name, value] of Object.entries({ ...typed, ...draftAsFormFields(draft) })) data.set(name, value);
  for (const document of ["Resume or CV", "Valid government ID"]) data.append("requiredDocuments", document);
  return { data, draft };
}

type Stored = { status: string; deadline: Date; description: string; requirements: string; responsibilities: unknown; benefits: unknown; responsibilities_type: string; benefits_type: string; responsibilities_strings: boolean; benefits_strings: boolean };
const stored = async (id: string) => (await db.query<Stored>(
  `SELECT status, deadline, description, requirements, responsibilities, benefits,
    jsonb_typeof(responsibilities) AS responsibilities_type, jsonb_typeof(benefits) AS benefits_type,
    COALESCE((SELECT bool_and(jsonb_typeof(e) = 'string') FROM jsonb_array_elements(responsibilities) e), true) AS responsibilities_strings,
    COALESCE((SELECT bool_and(jsonb_typeof(e) = 'string') FROM jsonb_array_elements(benefits) e), true) AS benefits_strings
   FROM public.job_postings WHERE id = $1`, [id])).rows[0];

/** Careers' public read: only an Open posting whose deadline has not passed (docs/job-postings.md, "Contract for Careers"). */
const careersCanSee = async (id: string) => (await db.query(`SELECT id FROM public.job_postings WHERE id = $1 AND status = 'open' AND deadline > now()`, [id])).rows.length === 1;

/** Careers' reading of the requirements text (`requirementItems` in brenraphaels-ecommerce): a list item per line, bullet markers stripped, section label lines skipped. */
const careersItems = (requirements: string) =>
  requirements.split("\n").map((line) => line.trim()).filter((line) => !/^(qualifications|responsibilities):$/i.test(line)).map((line) => line.replace(/^[-*•]\s*/, "")).filter(Boolean);

const PLAIN = /[*_`#>]|^\s*(?:[-•]|\d+[.)])\s/m;

describe("the plain-text check", () => {
  it("catches the markers the cleaner removes, so the checks below can fail", () => {
    for (const bad of ["**bold**", "__bold__", "`code`", "# Heading", "> quote", "- item", "• item", "1. item", "2) item", "line\n* item"]) expect(bad).toMatch(PLAIN);
    for (const good of ["Run the till at our Cainta branch.", "Can lift 20 kg", "Qualifications:\nAt least high school graduate"]) expect(good).not.toMatch(PLAIN);
  });
  it("would fail on text the cleaner had not cleaned", () => {
    expect(parseDraft(aiAnswer, NOTES)?.summary).not.toMatch(PLAIN);
    expect(aiAnswer.summary).toMatch(PLAIN);
    expect(aiAnswer.responsibilities.every((item) => PLAIN.test(item))).toBe(true);
  });
});

describe("an accepted AI draft saved as a Draft", () => {
  it("is stored as a Draft with the lists as arrays of strings and the text as plain text, and Careers cannot see it", async () => {
    const { data, draft } = acceptedDraftForm();
    const posting = await jobPostingsFor(handle, db).saveDraft(fieldsFromForm(data));
    const row = await stored(posting.id);
    expect(row.status).toBe("draft");
    expect(row).toMatchObject({ responsibilities_type: "array", benefits_type: "array", responsibilities_strings: true, benefits_strings: true });
    expect(row.responsibilities).toEqual(draft.responsibilities);
    expect(row.benefits).toEqual(draft.benefits);
    expect(await careersCanSee(posting.id)).toBe(false);
  });
});

describe("an accepted AI draft published", () => {
  const publish = async (extra: Record<string, string> = {}) => {
    const { data, draft } = acceptedDraftForm();
    const fields = { ...fieldsFromForm(data), deadline: new Date(Date.now() + 30 * 24 * 3600 * 1000), ...extra };
    const posting = await jobPostingsFor(handle, db).createAndPublish(fields);
    return { posting, draft, row: await stored(posting.id) };
  };

  it("has what Careers reads: status open, a future deadline, the lists as arrays of strings, and the description and requirements as plain text", async () => {
    const { posting, row } = await publish();
    expect(row.status).toBe("open");
    expect(row.deadline.getTime()).toBeGreaterThan(Date.now());
    expect(row).toMatchObject({ responsibilities_type: "array", benefits_type: "array", responsibilities_strings: true, benefits_strings: true });
    expect(typeof row.description).toBe("string");
    expect(typeof row.requirements).toBe("string");
    expect(row.description).not.toMatch(PLAIN);
    expect(row.requirements).not.toMatch(PLAIN);
    expect(await careersCanSee(posting.id)).toBe(true);
  });

  it("stores no markdown, bullet or number markers in any list item", async () => {
    const { row } = await publish();
    for (const item of [...(row.responsibilities as string[]), ...(row.benefits as string[])]) expect(item).not.toMatch(PLAIN);
  });

  it("saves Qualifications under their heading, which the form reads back and Careers shows as one item per line with no label line", async () => {
    const { row, draft } = await publish();
    expect(row.requirements).toBe(`Qualifications:\n${draft.qualifications.join("\n")}`);
    expect(splitRequirements(row.requirements)).toEqual({ responsibilities: "", qualifications: draft.qualifications.join("\n") });
    expect(careersItems(row.requirements)).toEqual(draft.qualifications);
    expect(careersItems(row.requirements)).not.toContain("Qualifications:");
  });

  it("keeps the Summary as the description, and the draft's text never reaches pay, openings, schedule or screening", async () => {
    const { posting, draft } = await publish();
    const { rows } = await db.query<Record<string, unknown>>(`SELECT * FROM public.job_postings WHERE id = $1`, [posting.id]);
    expect(rows[0].description).toBe(draft.summary);
    expect(rows[0]).toMatchObject({ salary_from: null, salary_to: null, work_schedule: null, openings: null, screening_criteria: [] });
  });

  it("round-trips: an Open posting's stored fields read back through the form give the same four text fields", async () => {
    const { posting, draft } = await publish();
    const read = await jobPostingsFor(handle, db).read(posting.id);
    expect(read).toMatchObject({ description: draft.summary, responsibilities: draft.responsibilities, benefits: draft.benefits });
    expect(splitRequirements(read!.requirements).qualifications.split("\n")).toEqual(draft.qualifications);
  });
});
