import { handleLive } from "@/lib/notifications/endpoints";
import { notificationsDeps } from "@/lib/notifications/notifications.server";

export async function POST(): Promise<Response> {
  return handleLive(notificationsDeps);
}
