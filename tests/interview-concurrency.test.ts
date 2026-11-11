import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { expect, it, vi } from "vitest";
import { applicationsFor } from "@/lib/applications";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

// PGlite queues statements on a single connection. This additional acceptance
// check uses independent PostgreSQL sessions to exercise lock wait/snapshots.
it.skipIf(!process.env.TEST_POSTGRES_URL)("prevents two independent Postgres sessions from double-booking an Interviewer", async () => {
  const admin = new pg.Client({ connectionString: process.env.TEST_POSTGRES_URL });
  await admin.connect();
  const name = `hrms_interview_${process.pid}`;
  const clients: pg.Client[] = [];
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(process.env.TEST_POSTGRES_URL!);
    url.pathname = `/${name}`;
    for (let index = 0; index < 2; index++) {
      const client = new pg.Client({ connectionString: url.toString() });
      await client.connect();
      clients.push(client);
    }
    const [first] = clients;
    await first.query(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
    await first.query(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
    await first.query("CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)");
    const directory = new URL("../migrations/", import.meta.url);
    for (const file of (await readdir(directory)).filter(file => file.endsWith(".sql")).sort()) {
      await first.query(await readFile(new URL(file, directory), "utf8"));
    }
    await first.query(`CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text PRIMARY KEY)`);
    await first.query(`INSERT INTO job_postings (id,title,department,description,requirements,employment_type,location,required_documents,screening_criteria,status)
      VALUES ('role','Cashier','Retail','','','Full time','Manila','[]','[]','open')`);
    await first.query("INSERT INTO applicant_profiles VALUES ('one','First Applicant','one@example.test'), ('two','Second Applicant','two@example.test')");
    await first.query(`INSERT INTO applications (applicant_id,job_posting_id,reference_number,status,profile_snapshot,documents_snapshot,consented_at)
      VALUES ('one','role','ONE','Interview','{"fullName":"First Applicant"}','[]',now()),
             ('two','role','TWO','Interview','{"fullName":"Second Applicant"}','[]',now())`);
    const portal = new FakePortal();
    portal.directory = [{ id: "bea", username: "bea", name: "Bea Santos", modules: ["Recruitment and Hiring"] }];
    const handle = portal.signIn({ name: "HR Staff", username: "hr", email: "hr@example.test", role: "HR Officer" }, ["Recruitment and Hiring"]);
    vi.stubGlobal("fetch", portalFetch(portal));
    vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
    vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
    vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
    vi.stubEnv("HRMS_DEV_BYPASS", "");
    const input = { startsAt: "2099-11-03T09:00:00+08:00", endsAt: "2099-11-03T10:00:00+08:00", type: "Online" as const, interviewerId: "bea", interviewerName: "Bea Santos", meetingLink: "https://meet.google.com/test" };
    const applications = clients.map(client => applicationsFor(handle, { query: async <T>(sql: string, values?: unknown[]) => ({ rows: (await client.query(sql, values)).rows as T[] }) }));
    // Hold the first save's transaction open so the second must wait for its
    // commit and then see the booking in a fresh snapshot.
    await first.query("BEGIN");
    await applications[0].scheduleInterview(1, "Interview", input);
    const secondPid = (await clients[1].query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const competing = applications[1].scheduleInterview(2, "Interview", input);
    const assertion = expect(competing).rejects.toMatchObject({ reason: "conflict", conflicts: [{ applicantName: "First Applicant" }] });
    // Test-only bounded observation: prove actual contention before releasing
    // the first session. PGlite cannot exercise this independent-session wait.
    await admin.query(`DO $$
      DECLARE deadline timestamptz := clock_timestamp() + interval '5 seconds';
      BEGIN
        LOOP
          PERFORM pg_stat_clear_snapshot();
          EXIT WHEN EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = ${secondPid} AND wait_event = 'advisory');
          IF clock_timestamp() > deadline THEN RAISE EXCEPTION 'Competing booking never waited on advisory lock'; END IF;
          PERFORM pg_sleep(0.01);
        END LOOP;
      END $$`);
    await first.query("COMMIT");
    await assertion;
    expect((await applications[0].readProfile(1)).interviews).toHaveLength(1);
    expect((await applications[1].readProfile(2)).interviews).toHaveLength(0);
  } finally {
    await Promise.all(clients.map(client => client.end()));
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
}, 30000);
