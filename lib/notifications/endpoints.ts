import { readInbox, type NotificationsClient } from "./notifications";

type Deps = {
  /** The signed-in User, resolved from the session. Never taken from the request. */
  resolveUser: () => Promise<{ id: string } | null>;
  client: NotificationsClient;
};

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function handleInbox({ resolveUser, client }: Deps): Promise<Response> {
  const user = await resolveUser();

  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  return json(await readInbox(client, user.id));
}

async function markRead(deps: Deps, mark: (client: NotificationsClient, userId: string) => Promise<void>) {
  const user = await deps.resolveUser();

  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    await mark(deps.client, user.id);

    return json({ ok: true });
  } catch (error) {
    console.error("Could not mark notifications read", error);

    return json({ error: "Notifications unavailable" }, 502);
  }
}

export function handleMarkRead(notificationId: string, deps: Deps): Promise<Response> {
  return markRead(deps, (client, userId) => client.markRead(userId, notificationId));
}

export function handleMarkAllRead(deps: Deps): Promise<Response> {
  return markRead(deps, (client, userId) => client.markAllRead(userId));
}

/** Ignores request-supplied identities: only the current session may obtain a pass. */
export async function handleLive({ resolveUser, client }: Deps): Promise<Response> {
  const user = await resolveUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  try {
    return json({ url: await client.liveUrl(user.id) });
  } catch {
    return json({ error: "Notifications unavailable" }, 502);
  }
}
