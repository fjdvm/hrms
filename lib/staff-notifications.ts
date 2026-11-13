import { database, type Database } from "./database";
import { listModuleHolders } from "./portal/client";
import { notificationsApp } from "./notifications/config";

/** Who is told: Staff holding the Module for the notification's area when delivery runs. */
const AUDIENCE_MODULES: Record<string, string> = { application: "Applications", "job-posting": "Job Postings", offer: "Offers" };

const audienceModule = (payload: Record<string, unknown>) =>
  typeof payload.type === "string" ? AUDIENCE_MODULES[payload.type.split(".")[0]] : undefined;

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
    const audiences = new Map<string, Promise<string[] | null>>();
    for (const row of rows) {
      try {
        // A notification for one person names them (`recipientIds`); the rest go to the holders of their area's Module.
        const { recipientIds, ...message } = row.payload;
        const named = Array.isArray(recipientIds) && recipientIds.length > 0 && recipientIds.every((id) => typeof id === "string") ? (recipientIds as string[]) : null;
        let audience: string[] | null;
        if (named) audience = named;
        else {
          const audienceOf = audienceModule(row.payload);
          if (!audienceOf) throw new Error("Unknown notification type");
          if (!audiences.has(audienceOf)) audiences.set(audienceOf, listModuleHolders(audienceOf));
          audience = (await audiences.get(audienceOf)) ?? null;
        }
        if (!audience) throw new Error("Recipients unavailable");
        if (audience.length > 0) {
          const url = process.env.API_GATEWAY_URL;
          const key = process.env.API_GATEWAY_KEY;
          if (!url || !key) throw new Error("Gateway configuration missing");
          const response = await fetch(`${url.replace(/\/$/, "")}/notifications/notifications`, {
            method: "POST",
            headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": row.id },
            // The notification service requires an absolute URL; SQL events store app-relative paths.
            body: JSON.stringify({ ...message,
              ...(typeof message.link === "string" ? { link: new URL(message.link, process.env.HRMS_APP_URL ?? "http://localhost:3001").href } : {}),
              sendingApp: notificationsApp(), targetApp: notificationsApp(), userIds: audience, idempotencyKey: row.id }),
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
