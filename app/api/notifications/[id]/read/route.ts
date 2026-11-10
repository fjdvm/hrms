import { handleMarkRead } from "@/lib/notifications/endpoints";
import { notificationsDeps } from "@/lib/notifications/notifications.server";

export async function POST(_request: Request, ctx: RouteContext<"/api/notifications/[id]/read">): Promise<Response> {
  const { id } = await ctx.params;

  return handleMarkRead(id, notificationsDeps);
}
