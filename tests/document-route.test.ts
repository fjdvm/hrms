import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { database } from "@/lib/database";
import { GET } from "@/app/api/applications/[id]/documents/[documentId]/route";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

const state = vi.hoisted(() => ({ handle: undefined as string | undefined, viewUrl: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => state.handle ? { value: state.handle } : undefined }) }));
vi.mock("@/lib/document-files", () => ({ gatewayDocumentFiles: () => ({ viewUrl: state.viewUrl }) }));
let db: PGlite;
let portal: FakePortal;

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
  await db.exec(`CREATE TABLE applicant_documents (id integer PRIMARY KEY, applicant_id text, file_id text);
    INSERT INTO job_postings (id,title,department,description,requirements,employment_type,location,required_documents,screening_criteria,status)
    VALUES ('posting','Cashier','Retail','','','Full time','Manila','[]','[]','open');
    INSERT INTO applications (applicant_id,job_posting_id,reference_number,status,profile_snapshot,documents_snapshot,consented_at)
    VALUES ('person','posting','REF','Received','{}','[{"id":7},{"id":9},{"id":10}]',now());
    INSERT INTO applicant_documents VALUES (7,'person','file-7'),(8,'person','file-8'),(9,'other','file-9'),(10,'person',NULL)`);
  vi.spyOn(database, "query").mockImplementation((sql, values) => db.query(sql, values));
  portal = new FakePortal();
  state.handle = portal.signIn({ name: "Ada", username: "ada", email: "ada@example.test", role: "HR Officer" }, ["Job Postings", "Applications", "Interviews", "Offers"]);
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
  state.viewUrl.mockReset().mockResolvedValue("https://files.test/signed");
});
afterEach(async () => {
  await db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const request = (id = "1", documentId = "7") => GET(new Request("https://hrms.test"), { params: Promise.resolve({ id, documentId }) });
it("redirects an authorized snapshot Document to its signed File address without caching", async () => {
  const response = await request();
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("https://files.test/signed");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(state.viewUrl).toHaveBeenCalledWith("file-7");
});
it.each(["8", "9", "10", "99"])("refuses inaccessible or missing Document %s", async (documentId) => {
  expect((await request("1", documentId)).status).toBe(404);
  expect(state.viewUrl).not.toHaveBeenCalled();
});
it("refuses an unknown Application", async () => expect((await request("99")).status).toBe(404));
it("answers not found on a file-storage failure", async () => {
  state.viewUrl.mockRejectedValue(new Error("offline"));
  expect((await request()).status).toBe(404);
});
it("refuses missing Staff session", async () => {
  state.handle = undefined;
  expect((await request()).status).toBe(401);
  expect(state.viewUrl).not.toHaveBeenCalled();
});
it("refuses Staff without the Module", async () => {
  state.handle = portal.signIn({ name: "Ada", username: "ada", email: "ada@example.test", role: "HR Officer" }, []);
  expect((await request()).status).toBe(403);
  expect(state.viewUrl).not.toHaveBeenCalled();
});
it("refuses an HR-added Application id", async () => {
  expect((await request("-1")).status).toBe(400);
  expect(state.viewUrl).not.toHaveBeenCalled();
});
it("never caches a refusal", async () => {
  for (const [id, documentId] of [["1", "8"], ["99", "7"], ["0", "7"]]) {
    expect((await request(id, documentId)).headers.get("cache-control")).toBe("private, no-store");
  }
  state.handle = undefined;
  expect((await request()).headers.get("cache-control")).toBe("private, no-store");
});
it("answers a File-less Document as not found without calling file-storage", async () => {
  await db.exec("UPDATE applicant_documents SET file_id = NULL WHERE id = 7");
  expect((await request()).status).toBe(404);
  expect(state.viewUrl).not.toHaveBeenCalled();
});
it.each(["0", "-1", "NaN", "1.5", "2147483648"])("rejects invalid ids %s", async (id) => {
  expect((await request(id)).status).toBe(400);
  expect((await request("1", id)).status).toBe(400);
});
