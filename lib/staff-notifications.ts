import { database, type Database } from "./database";
import { listModuleHolders } from "./portal/client";

/** Who is told: Staff holding the Recruitment and Hiring Module when delivery runs. */
const AUDIENCE_MODULE = "Recruitment and Hiring";

export const notificationsApp = () => process.env.NOTIFICATIONS_APP ?? "HRMS";

/**
 * Sends queued Staff Notifications (applications received, postings published or closed) to
 * the notifications service. Durable and bounded: a failure keeps the row for a later run, and
 * the stable idempotency key makes concurrent runs and retries safe. Never throws.
 */
export async function deliverStaffNotifications(db: Database = database): Promise<void> {
  try {
    const { rows } = await db.query<{ id: string; payload: Record<string, unknown> }>(`
      SELECT id, payload FROM public.hrms_staff_notifications
      WHERE delivered_at IS NULL AND next_attempt_at <= clock_timestamp()
      ORDER BY next_attempt_at, id LIMIT 50`);
    if (rows.length === 0) return;
    const audience = await listModuleHolders(AUDIENCE_MODULE);
    for (const row of rows) {
      try {
        if (!audience) throw new Error("Recipients unavailable");
        if (audience.length > 0) {
          const url = process.env.API_GATEWAY_URL;
          const key = process.env.API_GATEWAY_KEY;
          if (!url || !key) throw new Error("Gateway configuration missing");
          const response = await fetch(`${url.replace(/\/$/, "")}/notifications/notifications`, {
            method: "POST",
            headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": row.id },
            body: JSON.stringify({ ...row.payload, sendingApp: notificationsApp(), targetApp: notificationsApp(), userIds: audience, idempotencyKey: row.id }),
            cache: "no-store",
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok) throw new Error("Notification rejected");
        }
        await db.query("UPDATE public.hrms_staff_notifications SET delivered_at = clock_timestamp() WHERE id = $1", [row.id]);
      } catch {
        console.error("Staff notification failed; retained for retry", { deliveryId: row.id });
        await db.query(`UPDATE public.hrms_staff_notifications SET attempts = attempts + 1,
          next_attempt_at = clock_timestamp() + interval '1 minute' * LEAST(60, attempts + 1) WHERE id = $1`, [row.id]);
      }
    }
  } catch {
    console.error("Staff notification delivery unavailable; work retained");
  }
}
