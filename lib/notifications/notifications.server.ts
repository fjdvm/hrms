import { cookies } from "next/headers";
import { accessFor } from "@/lib/portal/access";
import { SESSION_COOKIE } from "@/lib/portal/config";
import { createNotificationsClient } from "./notifications";

/** The signed-in Staff member's Portal user id, from the session alone, never from the request. */
async function resolveUser() {
  const overview = await accessFor((await cookies()).get(SESSION_COOKIE)?.value).overview();

  return overview.decision === "allowed" && overview.staff.id ? { id: overview.staff.id } : null;
}

/** HRMS's connection to the notifications service, through the gateway with HRMS's Caller key. */
export const notificationsDeps = {
  resolveUser,
  client: createNotificationsClient({
    baseUrl: process.env.API_GATEWAY_URL ?? "",
    callerKey: process.env.API_GATEWAY_KEY ?? "",
    app: process.env.NOTIFICATIONS_APP ?? "HRMS",
  }),
};
