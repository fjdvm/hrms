import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { performanceFor, PerformanceError } from "@/lib/performance";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
const clock = new Date("2026-11-14T02:00:00Z");
const staff = { name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const performance = (handle: string | undefined) => performanceFor(handle, db, () => clock);

beforeEach(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(name, directory), "utf8"));
  }
  await db.exec(`CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text PRIMARY KEY);`);
  portal = new FakePortal();
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
});

afterEach(async () => {
  if (!db.closed) await db.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Performance access", () => {
  it("allows a Staff member who holds the Performance Module and names who they are", async () => {
    const handle = portal.signIn(staff, ["Performance"]);

    await expect(performance(handle).access()).resolves.toEqual({ decision: "allowed", staff });
  });

  it("denies a Staff member who does not hold it, whatever other Modules or role they have", async () => {
    const handle = portal.signIn({ ...staff, role: "Super Admin" }, ["Training", "Employee Information", "Dashboard"]);

    await expect(performance(handle).access()).resolves.toEqual({ decision: "denied" });
  });

  it("decides by the Module grant alone: a role named like a manager does not open it, and no role is needed", async () => {
    const manager = portal.signIn({ ...staff, role: "HRMS Manager" }, ["Training"]);
    const plain = portal.signIn({ ...staff, role: "Cashier" }, ["Performance"]);

    await expect(performance(manager).access()).resolves.toEqual({ decision: "denied" });
    await expect(performance(plain).access()).resolves.toMatchObject({ decision: "allowed" });
  });

  it("never reads a missing session or a Portal that cannot answer as no access", async () => {
    await expect(performance(undefined).access()).rejects.toMatchObject({ reason: "invalid" });
    await expect(performance("not-a-handle").access()).rejects.toBeInstanceOf(PerformanceError);

    const handle = portal.signIn(staff, ["Performance"]);
    portal.unavailable = true;
    await expect(performance(handle).access()).rejects.toMatchObject({ reason: "unavailable" });
  });
});
