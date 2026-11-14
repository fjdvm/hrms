import { shiftTrainingCalendar, trainingCalendarHref, trainingCalendarRange, trainingCalendarState, trainingCalendarTitle } from "@/lib/training-calendar";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trainingsFor, TrainingError } from "@/lib/trainings";
import { formatTrainingDate, formatTrainingTimes, readTrainingForm, trainingStatus, type TrainingTerms } from "@/lib/training-terms";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
// 14 Nov 2026, 10:00 in Manila.
let clock = new Date("2026-11-14T02:00:00Z");
const staff = { name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const trainings = (sessionHandle: string | undefined = handle) => trainingsFor(sessionHandle, db, () => clock);
const terms = (overrides: Partial<TrainingTerms> = {}): TrainingTerms => ({
  title: "Food safety and hygiene refresher", trainer: "QA Manager", description: "", objectives: "", date: "2026-11-18",
  startTime: "09:00", endTime: "11:00", mode: "In person", location: "Main kitchen, Antipolo", ...overrides,
});

beforeEach(async () => {
  clock = new Date("2026-11-14T02:00:00Z");
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
  handle = portal.signIn(staff, ["Training"]);
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

describe("derived Training status in Manila time", () => {
  const at = (iso: string) => new Date(iso);
  it("is Upcoming up to and including the day itself, then Completed", () => {
    // 15 Nov 23:59 in Manila is 15:59 UTC; 16 Nov 00:00 in Manila is 16:00 UTC the day before.
    expect(trainingStatus({ date: "2026-11-15", cancelled: false }, at("2026-11-15T15:59:00Z"))).toBe("Upcoming");
    expect(trainingStatus({ date: "2026-11-15", cancelled: false }, at("2026-11-15T16:00:00Z"))).toBe("Completed");
  });
  it("is Cancelled whatever the date, and never chosen", () => {
    expect(trainingStatus({ date: "2020-01-01", cancelled: true })).toBe("Cancelled");
    expect(trainingStatus({ date: "2999-01-01", cancelled: true })).toBe("Cancelled");
  });
});

describe("Trainings list", () => {
  it("creates Trainings and lists them with counts for All / Upcoming / Past / Cancelled", async () => {
    clock = new Date("2026-11-01T00:00:00Z");
    const past = await trainings().create(terms({ title: "Customer service basics", date: "2026-11-03" }));
    await trainings().create(terms({ title: "Allergen labeling", date: "2026-11-12" }));
    await trainings().create(terms({ title: "POS and cash handling", date: "2026-11-20", mode: "Online", location: "https://meet.example.com/pos" }));
    await trainings().create(terms({ title: "Halaya checks", date: "2026-11-19" }));
    await db.query(`UPDATE public.hrms_trainings SET cancelled_at = now() WHERE title = 'Allergen labeling'`);
    clock = new Date("2026-11-14T02:00:00Z");

    const all = await trainings().list();
    expect(all.counts).toEqual({ All: 4, Upcoming: 2, Past: 1, Cancelled: 1 });
    expect(all.thisMonth).toBe(4);
    expect(all.rows.map((row) => [row.title, row.status])).toEqual([
      ["Halaya checks", "Upcoming"], ["POS and cash handling", "Upcoming"], ["Allergen labeling", "Cancelled"], ["Customer service basics", "Completed"],
    ]);
    expect((await trainings().list("Upcoming")).rows.map((row) => row.title)).toEqual(["Halaya checks", "POS and cash handling"]);
    expect((await trainings().list("Past")).rows.map((row) => row.id)).toEqual([past]);
    expect((await trainings().list("Cancelled")).rows.map((row) => row.title)).toEqual(["Allergen labeling"]);
  });

  it("stores the title, trainer, description, objectives, one date and time, Mode and link or venue", async () => {
    await trainings().create(terms({ description: "  What it covers ", objectives: "One\n\n  Two  ", mode: "Online", location: "https://meet.example.com/a" }));
    const [row] = (await trainings().list()).rows;
    expect(row).toMatchObject({ title: "Food safety and hygiene refresher", trainer: "QA Manager", date: "2026-11-18", startTime: "09:00", endTime: "11:00", mode: "Online", status: "Upcoming", assigned: 0, completed: 0 });
    const stored = (await db.query<{ description: string; objectives: string; location: string; created_by_name: string }>(`SELECT * FROM public.hrms_trainings`)).rows[0];
    expect(stored).toMatchObject({ description: "What it covers", objectives: "One\nTwo", location: "https://meet.example.com/a", created_by_name: "Ada Okafor" });
  });

  it("counts Assigned and Completed employees and flags a past Training with no result recorded", async () => {
    clock = new Date("2026-11-01T00:00:00Z");
    const recorded = await trainings().create(terms({ date: "2026-11-05" }));
    const unrecorded = await trainings().create(terms({ title: "Safe lifting", date: "2026-11-10" }));
    clock = new Date("2026-11-14T02:00:00Z");
    await db.exec(`INSERT INTO public.hrms_training_assignments (training_id, employee_id, status) VALUES
      (${recorded}, 1, 'Completed'), (${recorded}, 2, 'Did not attend'), (${unrecorded}, 1, 'Assigned'), (${unrecorded}, 2, 'Assigned')`);
    const rows = Object.fromEntries((await trainings().list()).rows.map((row) => [row.id, row]));
    expect(rows[recorded]).toMatchObject({ assigned: 2, completed: 1, resultsNotRecorded: false });
    expect(rows[unrecorded]).toMatchObject({ assigned: 2, completed: 0, resultsNotRecorded: true });
  });

  it("refuses every operation without the Training Module", async () => {
    const other = portal.signIn(staff, ["Offers"]);
    await expect(trainings(other).list()).rejects.toMatchObject({ reason: "denied" });
    await expect(trainings(other).create(terms())).rejects.toMatchObject({ reason: "denied" });
    await expect(trainings("unknown-handle").list()).rejects.toBeInstanceOf(TrainingError);
    portal.unavailable = true;
    await expect(trainings().list()).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("refuses an invalid Training without saving it", async () => {
    await expect(trainings().create(terms({ title: "  " }))).rejects.toMatchObject({ reason: "validation" });
    await expect(trainings().create(terms({ date: "2026-11-13" }))).rejects.toMatchObject({ reason: "validation" });
    expect((await trainings().list()).counts.All).toBe(0);
  });
});

describe("the New training form's rules", () => {
  const raw = (overrides: Record<string, string> = {}) => ({ ...terms(), ...overrides });

  it("normalises whitespace and accepts a complete form", () => {
    const { terms: result, errors } = readTrainingForm(raw({ title: "  Fire   safety  ", location: " Main  kitchen " }), "2026-11-14");
    expect(errors).toEqual({});
    expect(result).toMatchObject({ title: "Fire safety", location: "Main kitchen" });
  });

  it("rejects, with a message and without stripping, markup in text fields", () => {
    const { terms: result, errors } = readTrainingForm(raw({ title: "<b>Hi</b>", trainer: "Ana\u0007" }), "2026-11-14");
    expect(result).toBeNull();
    expect(errors.title).toMatch(/without < or >/);
    expect(errors.trainer).toBeDefined();
  });

  it("needs every required field, a future date, an end after the start, and a link when Online", () => {
    const { errors } = readTrainingForm({ title: "", trainer: "", date: "2026-11-13", startTime: "10:00", endTime: "09:00", mode: "Online", location: "not a link" }, "2026-11-14");
    expect(Object.keys(errors).sort()).toEqual(["date", "endTime", "location", "title", "trainer"]);
    expect(readTrainingForm(raw({ date: "2026-11-14" }), "2026-11-14").errors.date).toBeUndefined();
    expect(readTrainingForm(raw({ mode: "Hybrid" }), "2026-11-14").errors.mode).toBeDefined();
  });

  it("formats dates and times as the list shows them", () => {
    expect(formatTrainingDate("2026-11-16")).toBe("Mon, 16 Nov 2026");
    expect(formatTrainingTimes("08:00", "09:00")).toBe("8:00 – 9:00 AM");
    expect(formatTrainingTimes("11:00", "13:30")).toBe("11:00 AM – 1:30 PM");
  });
});

describe("Training Calendar", () => {
  it("returns Trainings in the date range with Mode, soonest first, and derived status", async () => {
    clock = new Date("2026-11-01T00:00:00Z");
    await trainings().create(terms({ title: "Online POS", date: "2026-11-20", mode: "Online", location: "https://meet.example.com/pos" }));
    await trainings().create(terms({ title: "Kitchen safety", date: "2026-11-20", startTime: "08:00", endTime: "09:00" }));
    await trainings().create(terms({ title: "Allergens", date: "2026-11-05" }));
    await trainings().create(terms({ title: "Next month", date: "2026-12-01" }));
    await db.query(`UPDATE public.hrms_trainings SET cancelled_at = now() WHERE title = 'Allergens'`);
    clock = new Date("2026-11-14T02:00:00Z");

    const found = await trainings().calendar({ from: "2026-11-01", to: "2026-12-01" });
    expect(found.map((t) => [t.title, t.date, t.mode, t.status])).toEqual([
      ["Allergens", "2026-11-05", "In person", "Cancelled"],
      ["Kitchen safety", "2026-11-20", "In person", "Upcoming"],
      ["Online POS", "2026-11-20", "Online", "Upcoming"],
    ]);
    expect(found[2]).toMatchObject({ location: "https://meet.example.com/pos", startTime: "09:00", endTime: "11:00", assigned: 0 });
  });

  it("includes the first day and leaves out the end day of the range", async () => {
    await trainings().create(terms({ date: "2026-11-16" }));
    expect(await trainings().calendar({ from: "2026-11-16", to: "2026-11-17" })).toHaveLength(1);
    expect(await trainings().calendar({ from: "2026-11-10", to: "2026-11-16" })).toHaveLength(0);
  });

  it("refuses a bad range, and without the Training Module", async () => {
    await expect(trainings().calendar({ from: "2026-11-16", to: "2026-11-16" })).rejects.toMatchObject({ reason: "validation" });
    await expect(trainings().calendar({ from: "nope", to: "2026-11-16" })).rejects.toMatchObject({ reason: "validation" });
    const other = portal.signIn(staff, ["Offers"]);
    await expect(trainings(other).calendar({ from: "2026-11-01", to: "2026-12-01" })).rejects.toMatchObject({ reason: "denied" });
  });
});

describe("Training Calendar view state", () => {
  const now = new Date("2026-11-14T02:00:00Z");
  it("defaults to this month, covers whole Monday-first weeks, and steps by month or week", () => {
    const state = trainingCalendarState({}, now);
    expect(state).toEqual({ mode: "month", date: "2026-11-14" });
    expect(trainingCalendarRange(state)).toEqual({ from: "2026-10-26", to: "2026-12-07" });
    expect(shiftTrainingCalendar(state, 1)).toBe("2026-12-01");
    const week = trainingCalendarState({ mode: "week", date: "2026-11-14" }, now);
    expect(trainingCalendarRange(week)).toEqual({ from: "2026-11-09", to: "2026-11-16" });
    expect(shiftTrainingCalendar(week, -1)).toBe("2026-11-07");
    expect(trainingCalendarTitle(week)).toBe("9 – 15 November 2026");
    expect(trainingCalendarState({ mode: "year", date: "2026-13-40" }, now)).toEqual(state);
  });
  it("keeps links short", () => {
    expect(trainingCalendarHref({ mode: "month", date: "2026-11-14" }, now)).toBe("/training/calendar");
    expect(trainingCalendarHref({ mode: "week", date: "2026-11-20" }, now)).toBe("/training/calendar?mode=week&date=2026-11-20");
  });
});
