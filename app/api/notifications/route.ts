import { after } from "next/server";
import { handleInbox } from "@/lib/notifications/endpoints";
import { notificationsDeps } from "@/lib/notifications/notifications.server";
import { deliverStaffNotifications } from "@/lib/staff-notifications";

export async function GET(): Promise<Response> {
  // Opening a page connects the bell: also flush queued Notifications whose trigger ran elsewhere.
  after(() => deliverStaffNotifications());

  return handleInbox(notificationsDeps);
}
