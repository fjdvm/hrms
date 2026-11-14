import { database, type Database } from "./database";
import { notificationsApp } from "./notifications/config";

export const NOTICE_KINDS = ["Assignment", "Schedule changed", "Cancelled", "Reminder"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
/** What the log shows. A notice is Queued only until its first send, which the log words as Sending. */
export type NoticeState = "Queued" | "Sent" | "Retrying" | "Failed";

/** A failed email is retried this many times, this far apart, before the Employee is Not reached. */
export const MAX_RETRIES = 3;
export const RETRY_AFTER_MS = 15 * 60 * 1000;

export { assignmentEmail, scheduleChangedEmail, type NoticeTraining } from "./training-email";

/** The mailer boundary: one email through the notifications gateway. Throws when it was not accepted. */
export type SendEmail = (email: { id: string; payload: unknown }) => Promise<void>;

export const gatewaySendEmail: SendEmail = async ({ id, payload }) => {
  const url = process.env.API_GATEWAY_URL;
  const key = process.env.API_GATEWAY_KEY;
  if (!url || !key) throw new Error("Gateway configuration missing");
  const response = await fetch(`${url.replace(/\/$/, "")}/notifications/emails/app`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": id },
    body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Email rejected");
};

/** The row to queue for one Employee, or null when they have no email (they are never emailed). */
export function queueNotice(kind: NoticeKind, employee: { name: string; email: string | null }, content: { title: string; body: string }) {
  if (!employee.email) return null;
  return { kind, email: employee.email, payload: { to: employee.email, app: notificationsApp(), title: content.title, body: content.body } };
}

/**
 * Sends every notice that is due: Queued ones at once, Retrying ones once their time has come. A failure keeps the row,
 * counts the failed send, and schedules the next try about 15 minutes on; the third retry's failure makes it Failed
 * (Not reached). The stable idempotency key makes a repeat or a concurrent run safe. Never throws.
 */
export async function deliverTrainingNotices(db: Database = database, now: () => Date = () => new Date(), send: SendEmail = gatewaySendEmail): Promise<void> {
  try {
    const { rows } = await db.query<{ id: string; payload: unknown; attempts: number }>(`
      SELECT id::text AS id, payload, attempts FROM public.hrms_training_notices
      WHERE state IN ('Queued', 'Retrying') AND next_attempt_at <= $1::timestamptz
      ORDER BY next_attempt_at, id LIMIT 50`, [now().toISOString()]);
    for (const row of rows) {
      const at = now();
      try {
        await send({ id: `training-notice:${row.id}`, payload: row.payload });
        await db.query(`UPDATE public.hrms_training_notices SET state = 'Sent', sent_at = $2, last_attempt_at = $2, next_attempt_at = NULL
          WHERE id = $1 AND state IN ('Queued', 'Retrying')`, [row.id, at.toISOString()]);
      } catch {
        console.error("Training notice failed; kept for retry", { noticeId: row.id });
        const attempts = row.attempts + 1;
        // The first send plus MAX_RETRIES retries have all failed: the Employee is Not reached.
        const exhausted = attempts > MAX_RETRIES;
        await db.query(`UPDATE public.hrms_training_notices SET attempts = $2, last_attempt_at = $3,
          state = $4, next_attempt_at = $5::timestamptz WHERE id = $1 AND state IN ('Queued', 'Retrying')`,
        [row.id, attempts, at.toISOString(), exhausted ? "Failed" : "Retrying", exhausted ? null : new Date(at.getTime() + RETRY_AFTER_MS).toISOString()]);
      }
    }
  } catch {
    console.error("Training notice delivery unavailable; work retained");
  }
}

/** The daily-or-more-often job's route handler (`GET /api/cron/training-notices`), authorised like the other jobs. */
export function trainingNoticesJob(db: Database = database, now: () => Date = () => new Date(), send: SendEmail = gatewaySendEmail) {
  return async (request: Request): Promise<Response> => {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
    await deliverTrainingNotices(db, now, send);
    return Response.json({ ok: true });
  };
}
