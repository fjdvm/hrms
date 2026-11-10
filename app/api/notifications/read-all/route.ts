import { handleMarkAllRead } from "@/lib/notifications/endpoints";
import { notificationsDeps } from "@/lib/notifications/notifications.server";

export function POST(): Promise<Response> {
  return handleMarkAllRead(notificationsDeps);
}
