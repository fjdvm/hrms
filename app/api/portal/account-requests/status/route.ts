import { after } from "next/server";
import { StatusWebhookError, accountRequestStatusFor } from "@/lib/account-request-status";
import { readBody, unauthorized } from "@/lib/careers-caller";
import { isPortalCaller } from "@/lib/portal/webhook";
import { deliverStaffNotifications } from "@/lib/staff-notifications";

const headers = { "Cache-Control": "private, no-store" };

/**
 * The Portal tells HRMS how an Account request is going (contract in issue #315).
 * Body: `{ reference, status, actor, occurredAt, reason?, message? }`, `status` one of seen, account_created, login_sent, cancelled, declined.
 * Answers 200 for any valid delivery, including a repeat or an out-of-order one, so the Portal stops retrying.
 */
export async function POST(request: Request) {
  if (!isPortalCaller(request)) return unauthorized();
  const body = await readBody(request);
  try {
    await accountRequestStatusFor().receive(body);
  } catch (error) {
    if (error instanceof StatusWebhookError) {
      return Response.json({ error: error.reason }, { status: error.reason === "not-found" ? 404 : 400, headers });
    }
    console.error("Account request status failed");
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
  after(async () => { await deliverStaffNotifications(); });
  return Response.json({ ok: true }, { headers });
}
