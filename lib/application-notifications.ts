import { database, type Database } from "./database";

/** Durable, bounded delivery; concurrent workers share stable gateway keys. */
export async function retryApplicationNotifications(db: Database = database): Promise<void> {
  try {
    const { rows } = await db.query<{ id: string; payload: unknown; channel: string }>(`
      SELECT id, payload, channel FROM public.hrms_application_notifications
      WHERE delivered_at IS NULL AND next_attempt_at <= clock_timestamp()
      ORDER BY next_attempt_at, id LIMIT 50`);
    for (const row of rows) {
      try {
        const url = process.env.API_GATEWAY_URL;
        const key = process.env.API_GATEWAY_KEY;
        if (!url || !key) throw new Error("Gateway configuration missing");
        const response = await fetch(`${url.replace(/\/$/, "")}/notifications/${row.channel === "email" ? "emails/app" : "notifications"}`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": row.id },
          body: JSON.stringify(row.payload), cache: "no-store", signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error("Notification rejected");
        await db.query("UPDATE public.hrms_application_notifications SET delivered_at = clock_timestamp() WHERE id = $1", [row.id]);
      } catch {
        console.error("Application notification failed; retained for retry", { deliveryId: row.id });
        await db.query(`UPDATE public.hrms_application_notifications SET attempts = attempts + 1,
          next_attempt_at = clock_timestamp() + interval '1 minute' * LEAST(60, attempts + 1) WHERE id = $1`, [row.id]);
      }
    }
  } catch {
    console.error("Application notification retry unavailable; work retained");
  }
}
