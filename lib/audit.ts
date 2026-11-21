import { randomUUID } from "node:crypto";
import type { Staff } from "./portal/client";

/** The only database surface the audit helper needs; every Module's database type satisfies it. */
export type AuditDatabase = { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> };

/** audit-logs rejects larger metadata and these key names, so a bad event is refused here instead. */
export const MAX_AUDIT_METADATA_BYTES = 4096;
const SENSITIVE_KEY = /password|token|secret|authorization|card|cvv/i;

export class AuditEventError extends Error {}

function assertSafeKeys(value: unknown): void {
  if (Array.isArray(value)) value.forEach(assertSafeKeys);
  else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) throw new AuditEventError("Audit metadata has a sensitive-looking key");
      assertSafeKeys(nested);
    }
  }
}

/** Throws AuditEventError for metadata over 4 KB (UTF-8, serialized) or with a sensitive-looking key at any depth. */
export function assertAuditMetadata(metadata: unknown): void {
  if (metadata === undefined) return;
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) throw new AuditEventError("Audit metadata must be an object");
  assertSafeKeys(metadata);
  if (Buffer.byteLength(JSON.stringify(metadata), "utf8") > MAX_AUDIT_METADATA_BYTES) throw new AuditEventError("Audit metadata is over 4 KB");
}

export type AuditEventInput = {
  /** The Module name as audit-logs lists it for HRMS, for example "Training" or "Performance". */
  module: string;
  action: string;
  /** The Staff member who acted: their Portal id is the Actor id so My logs can find them. */
  staff: Pick<Staff, "id" | "username" | "name">;
  target: { type: string; id: string; display_name: string };
  description: string;
  metadata?: Record<string, unknown>;
  /** Stable per event; the outbox row and every retry reuse it. Generated when omitted. */
  idempotencyKey?: string;
};

export function buildAuditEvent(input: AuditEventInput) {
  assertAuditMetadata(input.metadata);
  const id = input.idempotencyKey ?? randomUUID();
  return {
    id,
    event: {
      source: "HRMS", module: input.module, action: input.action, outcome: "success",
      actor: { type: "user", id: input.staff.id ?? input.staff.username, display_name: input.staff.name },
      target: input.target, description: input.description, customer_description: null,
      occurred_at: new Date().toISOString(), idempotency_key: id,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
  };
}

/**
 * Queues an Audit event for any Module and Action in the same statement as the change: `sql` is a data-changing
 * statement with RETURNING, and one event is queued when it returns rows. Delivery runs inline after the commit and a
 * failure leaves the event queued. Returns the change's rows.
 */
export async function queueAuditedChange<T>(db: AuditDatabase, input: AuditEventInput, sql: string, values: unknown[] = []) {
  const { id, event } = buildAuditEvent(input);
  const result = await db.query<T>(`WITH changed AS (${sql}), queued AS (
    INSERT INTO public.hrms_audit_outbox (id, payload) SELECT $${values.length + 1}, $${values.length + 2}::jsonb
    WHERE EXISTS (SELECT 1 FROM changed) ON CONFLICT (id) DO NOTHING
  ) SELECT * FROM changed`, [...values, id, JSON.stringify(event)]);
  if (result.rows.length) await deliverAuditEvents(db, id);
  return result;
}

type AuditAction = "job_posting.created" | "job_posting.updated" | "job_posting.published"
  | "job_posting.closed" | "job_posting.filled" | "job_template.created"
  | "job_template.updated" | "job_template.deleted";

/** The mutation and its delivery record commit together in one SQL statement. */
export async function auditedMutation<T>(db: AuditDatabase, staff: Staff, action: AuditAction, sql: string, values: unknown[], templateName?: string) {
  const id = randomUUID();
  const type = action.split(".")[0];
  const event = {
    source: "HRMS", module: "Job Postings", action, outcome: "success",
    actor: { type: "user", id: staff.id ?? staff.username, display_name: staff.name },
    customer_description: null, occurred_at: new Date().toISOString(), idempotency_key: id,
    description: `${staff.name} performed ${action}.`,
    ...(action === "job_posting.published" ? { metadata: { applicants_notified: false } } : {}),
  };
  // Copy only reusable content from the row actually saved, in the same statement.
  const templateId = randomUUID();
  const templateAuditId = randomUUID();
  const templateSql = templateName === undefined ? "" : `, saved_template AS (
    INSERT INTO public.job_templates
      (id, name, title, department, employment_type, location, description, requirements,
       required_documents, screening_criteria, openings, salary_from, salary_to, work_schedule, responsibilities, benefits)
    SELECT $${values.length + 5}, $${values.length + 6}, title, department, "employmentType", location,
      description, requirements, "requiredDocuments", "screeningCriteria", openings,
      "salaryFrom", "salaryTo", "workSchedule", responsibilities, benefits FROM changed RETURNING id, title
  ), template_queued AS (
    INSERT INTO public.hrms_audit_outbox (id, payload)
    SELECT $${values.length + 7}, $${values.length + 8}::jsonb || jsonb_build_object(
      'target', jsonb_build_object('type', 'job_template', 'id', id,
        'display_name', COALESCE(NULLIF(title, ''), id))) FROM saved_template
  )`;
  const templateValues = templateName === undefined ? [] : [templateId, templateName, templateAuditId,
    JSON.stringify({ ...event, action: "job_template.created", metadata: undefined,
      description: `${staff.name} performed job_template.created.`, idempotency_key: templateAuditId })];
  const result = await db.query<T>(`WITH changed AS (${sql}), queued AS (
    INSERT INTO public.hrms_audit_outbox (id, payload)
    SELECT $${values.length + 1}, $${values.length + 2}::jsonb || jsonb_build_object(
      'target', jsonb_build_object('type', $${values.length + 3}::text, 'id', id,
        'display_name', COALESCE(NULLIF(title, ''), id))) FROM changed
  ), announcement AS (
    INSERT INTO public.hrms_posting_announcements (posting_id, audit_id, title)
    SELECT id, $${values.length + 1}, title FROM changed
    WHERE $${values.length + 4}::boolean
    ON CONFLICT (posting_id) DO NOTHING
  )${templateSql} SELECT * FROM changed`, [...values, id, JSON.stringify(event), type, action === "job_posting.published", ...templateValues]);
  // Delivery failure is isolated from the already committed Staff action.
  if (result.rows.length) {
    await deliverAuditEvents(db, id);
    if (templateName !== undefined) await deliverAuditEvents(db, templateAuditId);
  }
  return result;
}

/**
 * Delivers due queued Audit events, up to 50 per call; a failure keeps the event and backs off 1-60 minutes. An event
 * whose linked announcement is not complete is held back (the Job Posting guard). Also run by the maintenance route.
 */
export async function deliverAuditEvents(db: AuditDatabase, eventId?: string): Promise<void> {
  try {
    const { rows } = await db.query<{ id: string; payload: unknown }>(
      `SELECT id, payload FROM public.hrms_audit_outbox
       WHERE ($1::text IS NULL OR id = $1) AND next_attempt_at <= clock_timestamp()
         AND NOT EXISTS (SELECT 1 FROM public.hrms_posting_announcements a
           WHERE a.audit_id = hrms_audit_outbox.id AND a.completed_at IS NULL)
       ORDER BY next_attempt_at, id LIMIT 50`, [eventId ?? null]);
    for (const row of rows) {
      try {
        const url = process.env.API_GATEWAY_URL;
        const key = process.env.API_GATEWAY_KEY;
        if (!url || !key) throw new Error("Gateway configuration missing");
        const response = await fetch(`${url.replace(/\/$/, "")}/audit/events`, {
          method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify(row.payload), cache: "no-store", signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error("Audit gateway rejected event");
        await db.query("DELETE FROM public.hrms_audit_outbox WHERE id = $1", [row.id]);
      } catch {
        console.error("Audit delivery failed; retained for retry", { eventId: row.id });
        await db.query(`UPDATE public.hrms_audit_outbox SET attempts = attempts + 1,
          next_attempt_at = clock_timestamp() + interval '1 minute' * LEAST(60, attempts + 1)
          WHERE id = $1`, [row.id]);
      }
    }
  } catch {
    console.error("Audit retry unavailable; delivery records retained");
  }
}
