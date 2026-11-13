import { database, type Database } from "./database";
import { deliverStaffNotifications } from "./staff-notifications";

/** The Manila calendar date of an instant, `YYYY-MM-DD`. */
export const manilaDate = (at: Date) => at.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

// One statement, so the switch, its audit row (the Employee audit trigger records it as "System") and the notification
// happen together or not at all, and a second run finds nothing left to do.
// A person is due when they are still Onboarding, their start date (a Manila date) is today or earlier, and either their active
// request has an account ("account_created" or "login_sent") or "No account needed" is set. The start date itself counts.
// The requester is told: the person who sent the request, or, with no request, the person who set "No account needed".
const ACTIVATE = `
WITH due AS (
  UPDATE public.hrms_employees e SET status = 'Active'
  WHERE e.status = 'Onboarding' AND e.start_date <= $1::date
    AND ($2::text IS NULL OR e.id = (SELECT q.employee_id FROM public.hrms_account_requests q WHERE q.reference = $2))
    AND (e.no_account_needed_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.hrms_account_requests q WHERE q.employee_id = e.id AND q.status IN ('account_created', 'login_sent')))
  RETURNING e.id, e.full_name, e.no_account_needed_by
), notice AS (
  INSERT INTO public.hrms_staff_notifications (id, payload)
  SELECT 'employee.active:' || d.id::text, jsonb_build_object(
    'type', 'employee.active',
    'title', d.full_name || ' is now Active',
    'body', d.full_name || ' has started, so their Employee record is now Active.',
    'link', '/employee-information/' || d.id::text,
    'recipientIds', jsonb_build_array(COALESCE(r.requester_id, d.no_account_needed_by)))
  FROM due d
  LEFT JOIN LATERAL (SELECT q.requester_id FROM public.hrms_account_requests q
    WHERE q.employee_id = d.id AND q.status IN ('account_created', 'login_sent') ORDER BY q.id DESC LIMIT 1) r ON true
  WHERE COALESCE(r.requester_id, d.no_account_needed_by) IS NOT NULL
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
SELECT count(*)::int AS activated FROM due`;

/**
 * Makes every Onboarding person who is due Active, as of the Manila date of `now`. Idempotent. With `reference`, looks only at
 * the person that Account request belongs to (the Portal webhook); without it, at everyone (the daily job).
 */
export async function activateDue(db: Database = database, now: () => Date = () => new Date(), reference?: string): Promise<number> {
  const { rows } = await db.query<{ activated: number }>(ACTIVATE, [manilaDate(now()), reference ?? null]);
  return rows[0].activated;
}

/** The daily job's route handler (`GET /api/cron/employee-activation`), with the database, clock and delivery injectable for tests. */
export function employeeActivationJob(db: Database = database, now: () => Date = () => new Date(), deliver: (db: Database) => Promise<void> = deliverStaffNotifications) {
  return async (request: Request): Promise<Response> => {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
    try {
      const activated = await activateDue(db, now);
      await deliver(db);
      return Response.json({ ok: true, activated });
    } catch {
      console.error("Employee activation failed");
      return Response.json({ error: "unavailable" }, { status: 503 });
    }
  };
}
