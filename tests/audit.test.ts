import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuditEventError, assertAuditMetadata, deliverAuditEvents, queueAuditedChange } from "@/lib/audit";

const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
let db: PGlite;
let sent: { body: Record<string, unknown>; auth: string | null }[];
let gatewayStatus = 201;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("../migrations/0003-job-posting-audit.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../migrations/0004-job-posting-announcements.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE public.change_log (id text PRIMARY KEY, title text)`);
  sent = [];
  gatewayStatus = 201;
  vi.stubEnv("API_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("API_GATEWAY_KEY", "hrms-test-key");
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input)).toBe("https://gateway.test/audit/events");
    sent.push({ body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization") });
    return Response.json({}, { status: gatewayStatus });
  });
});
afterEach(async () => { await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const create = (module: string, action: string, id = "t1", metadata?: Record<string, unknown>, key?: string) => queueAuditedChange<{ id: string }>(
  db, { module, action, staff, target: { type: "training", id, display_name: "Till training" }, description: `${staff.name} did ${action}.`, metadata, idempotencyKey: key },
  `INSERT INTO public.change_log (id, title) VALUES ($1, 'Till training') RETURNING id`, [id]);

it.each([["Training", "training.created"], ["Performance", "rating.saved"], ["Job Postings", "job_posting.created"]])(
  "queues and delivers an event for %s / %s with the Staff Portal id as Actor", async (module, action) => {
    const result = await create(module, action, "t1", { training_id: "t1", employee_count: 3 });
    expect(result.rows).toEqual([{ id: "t1" }]);
    expect(sent).toHaveLength(1);
    expect(sent[0].auth).toBe("Bearer hrms-test-key");
    expect(sent[0].body).toMatchObject({
      source: "HRMS", module, action, outcome: "success",
      actor: { type: "user", id: "u-ada", display_name: "Ada Okafor" },
      target: { type: "training", id: "t1", display_name: "Till training" },
      metadata: { training_id: "t1", employee_count: 3 },
    });
    expect(sent[0].body.idempotency_key).toBeTruthy();
    expect((await db.query("SELECT 1 FROM public.hrms_audit_outbox")).rows).toHaveLength(0);
  });

it("commits the change and the queued event together, and keeps a stable idempotency key across retries", async () => {
  gatewayStatus = 503;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await create("Training", "training.created", "t1", undefined, "training.created:t1");
    expect((await db.query("SELECT 1 FROM public.change_log")).rows).toHaveLength(1);
    const queued = (await db.query<{ id: string; attempts: number; next_attempt_at: string }>("SELECT id, attempts, next_attempt_at FROM public.hrms_audit_outbox")).rows;
    expect(queued).toMatchObject([{ id: "training.created:t1", attempts: 1 }]);
    expect(new Date(queued[0].next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    await db.query("UPDATE public.hrms_audit_outbox SET next_attempt_at = '2000-01-01'");
    gatewayStatus = 201;
    await deliverAuditEvents(db);
    expect(sent.map((call) => call.body.idempotency_key)).toEqual(["training.created:t1", "training.created:t1"]);
    expect((await db.query("SELECT 1 FROM public.hrms_audit_outbox")).rows).toHaveLength(0);
  } finally { log.mockRestore(); }
});

it("queues nothing when the change affects no row", async () => {
  const result = await queueAuditedChange(db, { module: "Training", action: "training.updated", staff, target: { type: "training", id: "x", display_name: "x" }, description: "d" },
    `UPDATE public.change_log SET title = 'x' WHERE id = 'missing' RETURNING id`);
  expect(result.rows).toHaveLength(0);
  expect(sent).toHaveLength(0);
  expect((await db.query("SELECT 1 FROM public.hrms_audit_outbox")).rows).toHaveLength(0);
});

it("refuses metadata over 4 KB or with a sensitive key before anything is written", async () => {
  const bad: Record<string, unknown>[] = [
    { note: "é".repeat(2043) },
    ...["password", "accessToken", "client_secret", "Authorization", "creditCard", "CVV"].flatMap((name) => [{ [name]: "x" }, { nested: [{ deeper: { [name]: "x" } }] }]),
  ];
  for (const metadata of bad) await expect(create("Training", "training.created", "t1", metadata)).rejects.toBeInstanceOf(AuditEventError);
  expect((await db.query("SELECT 1 FROM public.change_log")).rows).toHaveLength(0);
  expect((await db.query("SELECT 1 FROM public.hrms_audit_outbox")).rows).toHaveLength(0);
  expect(() => assertAuditMetadata({ note: "é".repeat(2042) })).not.toThrow();
  expect(() => assertAuditMetadata({ ids: ["a", "b"], count: 2 })).not.toThrow();
});

it("holds back an event whose Job Posting announcement is not complete, and delivers it once it is", async () => {
  await db.query("INSERT INTO public.hrms_audit_outbox (id, payload) VALUES ('held', '{\"action\":\"job_posting.published\"}')");
  await db.query("INSERT INTO public.hrms_posting_announcements (posting_id, audit_id, title) VALUES ('p1', 'held', 'Cashier')");
  await deliverAuditEvents(db);
  expect(sent).toHaveLength(0);
  await db.query("UPDATE public.hrms_posting_announcements SET completed_at = now()");
  await deliverAuditEvents(db);
  expect(sent).toHaveLength(1);
});
