import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/dashboard/export/route";
import { database } from "@/lib/database";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

const state = vi.hoisted(() => ({ handle: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (state.handle ? { value: state.handle } : undefined) }) }));

let db: PGlite;
let portal: FakePortal;
const staff = { name: "Ada", username: "ada", email: "ada@example.test", role: "HR Officer" };

beforeEach(async () => {
  db = new PGlite();
  for (const fixture of ["careers-job-postings.sql", "careers-applications.sql"]) {
    await db.exec(await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8"));
  }
  await db.exec("CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text, email text)");
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(name, directory), "utf8"));
  }
  await db.exec(`INSERT INTO job_postings (id,title,department,description,requirements,employment_type,location,required_documents,screening_criteria,status,openings)
    VALUES ('posting','Cashier','Retail','','','Full time','Manila','[]','[]','open',3);
    INSERT INTO applicant_profiles VALUES ('one','One','one@example.test'),('two','Two','two@example.test');
    INSERT INTO applications (applicant_id,job_posting_id,reference_number,status,profile_snapshot,documents_snapshot,consented_at,created_at)
    VALUES ('one','posting','R1','Received','{"fullName":"One"}','[]','2026-10-05T00:00:00Z','2026-10-05T00:00:00Z'),
           ('two','posting','R2','Received','{"fullName":"Two"}','[]','2026-09-05T00:00:00Z','2026-09-05T00:00:00Z')`);
  vi.spyOn(database, "query").mockImplementation((sql, values) => db.query(sql, values));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T12:05:00Z"));
  portal = new FakePortal();
  state.handle = portal.signIn(staff, ["Job Postings", "Applications", "Interviews", "Offers"]);
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
});

afterEach(async () => {
  await db.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const request = (search = "") => GET(new Request(`https://hrms.test/api/dashboard/export${search}`));

it("returns a CSV with one row per hiring card, matching the page for the same range", async () => {
  const response = await request("?range=this-month");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="dashboard-hiring-2026-10-01_to_2026-10-28.csv"');
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await response.text()).split("\r\n")).toEqual([
    "Card,Value,Detail,Comparison",
    "Open jobs,1,3 openings · 1 location,",
    "Applicants,1,,No change vs last month",
    "Interviews this week,0,None today,",
    "Offer acceptance,,,",
    "Average time to hire,,,",
    "",
  ]);
});

it("names the file for a valid Custom range and counts its Applications", async () => {
  const response = await request("?range=custom&from=2026-09-01&to=2026-09-30");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="dashboard-hiring-2026-09-01_to_2026-09-30.csv"');
  expect(await response.text()).toContain("Applicants,1,,");
});

it.each([
  "?range=nonsense",
  "?range=custom",
  "?range=custom&from=2026-10-15&to=2026-09-01",
  "?range=custom&from=2026-02-30&to=2026-03-01",
  "?range=custom&from=2026-10-01&to=2026-10-29",
  "?range=custom&from=2025-01-01&to=2026-10-28",
])("falls back to This month for the invalid range %s", async (search) => {
  expect((await request(search)).headers.get("content-disposition")).toBe(
    'attachment; filename="dashboard-hiring-2026-10-01_to_2026-10-28.csv"',
  );
});

it("refuses a request without a session", async () => {
  state.handle = undefined;
  const response = await request();
  expect(response.status).toBe(401);
  expect(response.headers.get("content-type")).not.toContain("text/csv");
});

it("refuses Staff who hold none of the hiring Modules", async () => {
  state.handle = portal.signIn(staff, ["Training"]);
  const response = await request();
  expect(response.status).toBe(403);
  expect(response.headers.get("content-type")).not.toContain("text/csv");
});

it("holds only the hiring cards the Staff member's Modules own", async () => {
  state.handle = portal.signIn(staff, ["Interviews"]);
  expect((await (await request("?range=this-month")).text()).split("\r\n")).toEqual([
    "Card,Value,Detail,Comparison",
    "Interviews this week,0,None today,",
    "",
  ]);
});
