import { database, type Database } from "./database";

/**
 * Sends queued Offer emails through the notifications gateway. A row is due once its
 * next_attempt_at has passed, so "now" and a later time share one path. Failures keep the row
 * and back off; the stable idempotency key makes retries and concurrent runs safe. Never throws.
 */
export async function deliverOfferEmails(db: Database = database): Promise<void> {
  try {
    const { rows } = await db.query<{ id: string; offerId: number; payload: unknown }>(`
      SELECT id, offer_id AS "offerId", payload FROM public.hrms_offer_emails
      WHERE delivered_at IS NULL AND next_attempt_at <= clock_timestamp()
      ORDER BY next_attempt_at, id LIMIT 50`);
    for (const row of rows) {
      try {
        const url = process.env.API_GATEWAY_URL;
        const key = process.env.API_GATEWAY_KEY;
        if (!url || !key) throw new Error("Gateway configuration missing");
        const response = await fetch(`${url.replace(/\/$/, "")}/notifications/emails/app`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": row.id },
          body: JSON.stringify(row.payload), cache: "no-store", signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error("Email rejected");
        await db.query(`
          WITH done AS (
            UPDATE public.hrms_offer_emails SET delivered_at = clock_timestamp() WHERE id = $1 AND delivered_at IS NULL RETURNING offer_id
          ) INSERT INTO public.hrms_offer_activity (offer_id, kind, detail) SELECT offer_id, 'email-sent', CASE WHEN $1 LIKE 'offer.docs:%' THEN 'Documents email sent' ELSE 'Offer email sent' END FROM done`, [row.id]);
      } catch {
        console.error("Offer email failed; retained for retry", { deliveryId: row.id });
        await db.query(`UPDATE public.hrms_offer_emails SET attempts = attempts + 1,
          next_attempt_at = clock_timestamp() + interval '1 minute' * LEAST(60, attempts + 1) WHERE id = $1`, [row.id]);
      }
    }
  } catch {
    console.error("Offer email delivery unavailable; work retained");
  }
}
