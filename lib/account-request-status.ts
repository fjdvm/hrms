import { database, type Database } from "./database";
import { activateDue } from "./employee-activation";

export const PORTAL_STATUSES = ["seen", "account_created", "login_sent", "cancelled", "declined"] as const;
export type PortalStatus = (typeof PORTAL_STATUSES)[number];

export class StatusWebhookError extends Error {
  constructor(public readonly reason: "validation" | "not-found") {
    super(`Account request status: ${reason}`);
  }
}

export type StatusDelivery = { reference: string; status: PortalStatus; actor: string; occurredAt: string; reason: string | null; message: string | null };

const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() !== "" && value.length <= max ? value.trim() : null);

/** The delivery as HRMS understands it, or a validation error. `reason` and `message` are kept only for `declined`. */
export function parseDelivery(body: unknown): StatusDelivery {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const reference = typeof raw.reference === "string" && /^RQ-\d{4,9}$/.test(raw.reference) ? raw.reference : null;
  const status = PORTAL_STATUSES.find((s) => s === raw.status);
  const actor = text(raw.actor, 200);
  const when = typeof raw.occurredAt === "string" ? new Date(raw.occurredAt) : null;
  const year = when?.getUTCFullYear();
  if (!reference || !status || !actor || !when || Number.isNaN(when.getTime()) || year! < 2000 || year! > 2100) throw new StatusWebhookError("validation");
  const optional = (value: unknown, max: number) => {
    if (value === undefined || value === null) return null;
    const cleaned = text(value, max);
    if (!cleaned) throw new StatusWebhookError("validation");
    return cleaned;
  };
  const reason = optional(raw.reason, 500);
  const message = optional(raw.message, 2000);
  return { reference, status, actor, occurredAt: when.toISOString(), reason: status === "declined" ? reason : null, message: status === "declined" ? message : null };
}

// One statement, so a delivery is applied or not at all. Rules:
// - every valid delivery records its step once (unique per request and status), whatever order it arrives in;
// - the request only moves forward along requested → seen → account_created → login_sent;
// - cancelled and declined apply only while nothing has built an account (requested or seen);
// - an account that exists wins over a cancel or decline, whichever arrives first, so HRMS never pretends to undo a real account;
// - the requester is notified once when the account is created, and once when the request is declined.
const APPLY = `
WITH req AS (
  SELECT id, status, employee_id, requester_id FROM public.hrms_account_requests WHERE reference = $1 FOR UPDATE
), decided AS (
  SELECT req.*,
    CASE status WHEN 'requested' THEN 0 WHEN 'seen' THEN 1 WHEN 'account_created' THEN 2 WHEN 'login_sent' THEN 3 ELSE -1 END AS rank_cur,
    CASE $2::text WHEN 'seen' THEN 1 WHEN 'account_created' THEN 2 WHEN 'login_sent' THEN 3 ELSE -1 END AS rank_new
  FROM req
), plan AS (
  SELECT decided.*,
    CASE
      WHEN $2::text IN ('account_created','login_sent') THEN CASE WHEN rank_cur >= rank_new THEN status ELSE $2::text END
      WHEN $2::text = 'seen' THEN CASE WHEN status = 'requested' THEN 'seen' ELSE status END
      ELSE CASE WHEN status IN ('requested','seen') THEN $2::text ELSE status END
    END AS next_status,
    NOT ($2::text IN ('cancelled','declined') AND status IN ('account_created','login_sent')) AS records
  FROM decided
), step AS (
  INSERT INTO public.hrms_account_request_events (request_id, status, actor_name, reason, message, occurred_at)
  SELECT id, $2, $3, $5, $6, $4::timestamptz FROM plan WHERE records
  ON CONFLICT (request_id, status) WHERE status <> 'reminded' DO NOTHING
  RETURNING request_id
), moved AS (
  UPDATE public.hrms_account_requests r SET status = p.next_status,
    account_created_at = CASE WHEN $2::text = 'account_created' THEN COALESCE(r.account_created_at, $4::timestamptz) ELSE r.account_created_at END,
    account_created_by = CASE WHEN $2::text = 'account_created' THEN COALESCE(r.account_created_by, $3) ELSE r.account_created_by END
  FROM plan p WHERE r.id = p.id AND p.records
  RETURNING r.id
), notice AS (
  INSERT INTO public.hrms_staff_notifications (id, payload)
  SELECT 'account-request.' || $2::text || ':' || $1::text, jsonb_build_object(
    'type', 'account-request.' || $2::text,
    'title', CASE WHEN $2::text = 'declined' THEN 'Account request declined: ' ELSE 'Account created: ' END || e.full_name,
    'body', CASE WHEN $2::text = 'declined'
      THEN 'The Portal administrator declined ' || $1::text || COALESCE(': ' || $5::text, '') || '.'
      ELSE 'The Portal account for ' || e.full_name || ' (' || $1::text || ') has been created.' END,
    'link', '/employee-onboarding#employee-' || p.employee_id,
    'recipientIds', jsonb_build_array(p.requester_id))
  FROM plan p JOIN public.hrms_employees e ON e.id = p.employee_id
  WHERE p.records AND ($2::text = 'account_created' OR ($2::text = 'declined' AND p.status IN ('requested','seen')))
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
SELECT (SELECT count(*) FROM req)::int AS found`;

// Used only when moving the request would break "one active request per Employee record": an account was created for a request
// that was cancelled or declined after the person was given a new one. The step is still recorded; the status is left alone.
const RECORD_ONLY = `
INSERT INTO public.hrms_account_request_events (request_id, status, actor_name, reason, message, occurred_at)
SELECT id, $2, $3, $5, $6, $4::timestamptz FROM public.hrms_account_requests WHERE reference = $1
ON CONFLICT (request_id, status) WHERE status <> 'reminded' DO NOTHING`;

/** Applies the Portal's status deliveries. Idempotent and tolerant of out-of-order delivery. */
export function accountRequestStatusFor(db: Database = database, now: () => Date = () => new Date()) {
  return {
    async receive(body: unknown): Promise<void> {
      const d = parseDelivery(body);
      const values = [d.reference, d.status, d.actor, d.occurredAt, d.reason, d.message];
      let found: number;
      try {
        found = (await db.query<{ found: number }>(APPLY, values)).rows[0].found;
      } catch (error) {
        if ((error as { code?: string }).code !== "23505") throw error;
        console.error("Account request status recorded without changing status", { reference: d.reference, status: d.status });
        await db.query(RECORD_ONLY, values);
        return;
      }
      if (found === 0) throw new StatusWebhookError("not-found");
      // An account that now exists may be all this person was waiting for (#345). If this fails the Portal retries, and the daily job catches up.
      await activateDue(db, now, d.reference);
    },
  };
}
