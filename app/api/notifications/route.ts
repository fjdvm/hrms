import { after } from "next/server";
import { handleInbox } from "@/lib/notifications/endpoints";
import { notificationsDeps } from "@/lib/notifications/notifications.server";
import { deliverStaffNotifications } from "@/lib/staff-notifications";

export async function GET(): Promise<Response> {
  const response = await handleInbox(notificationsDeps);

  // Opening a page connects the bell: also flush queued Notifications whose trigger ran
  // elsewhere. Only for a signed-in Staff member, so an anonymous request cannot cause work.
  if (response.status !== 401) after(() => deliverStaffNotifications());

  return response;
}
