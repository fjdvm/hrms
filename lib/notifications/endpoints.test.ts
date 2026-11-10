import { describe, expect, it, vi } from "vitest";

import { handleInbox, handleLive, handleMarkAllRead, handleMarkRead } from "./endpoints";
import type { NotificationsClient } from "./notifications";

function setup(user: { id: string } | null = { id: "u1" }) {
  const client: NotificationsClient = {
    liveUrl: vi.fn().mockResolvedValue("wss://gateway.test/notifications/live?ticket=pass"),
    list: vi.fn().mockResolvedValue([
      { id: "n1", title: "New application: Kristine Aquino", link: null, createdAt: "2026-10-20T01:00:00.000Z", read: false },
    ]),
    unreadCount: vi.fn().mockResolvedValue(1),
    markRead: vi.fn().mockResolvedValue(undefined),
    markAllRead: vi.fn().mockResolvedValue(undefined),
  };
  const deps = { resolveUser: async () => user, client };
  return { client, deps };
}

describe("notification endpoints", () => {
  it("returns the signed-in User's inbox", async () => {
    const { client, deps } = setup();

    const response = await handleInbox(deps);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ available: true, unread: 1, notifications: [{ id: "n1" }] });
    expect(client.list).toHaveBeenCalledWith("u1");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns an empty, unavailable inbox with 200 when the service is down", async () => {
    const { client, deps } = setup();
    vi.mocked(client.unreadCount).mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await handleInbox(deps);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: false, unread: 0, notifications: [] });
  });

  it("marks one read for the signed-in User only", async () => {
    const { client, deps } = setup();

    const response = await handleMarkRead("n1", deps);

    expect(response.status).toBe(200);
    expect(client.markRead).toHaveBeenCalledWith("u1", "n1");
  });

  it("marks all read for the signed-in User", async () => {
    const { client, deps } = setup();

    expect((await handleMarkAllRead(deps)).status).toBe(200);
    expect(client.markAllRead).toHaveBeenCalledWith("u1");
  });

  it("answers 502 when marking read fails, so the bell can recover", async () => {
    const { client, deps } = setup();
    vi.mocked(client.markAllRead).mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await handleMarkAllRead(deps)).status).toBe(502);
  });

  it("issues a Live ticket for the signed-in User only, ignoring any identity in the request", async () => {
    const { client, deps } = setup();

    const response = await handleLive(deps);

    expect(await response.json()).toEqual({ url: "wss://gateway.test/notifications/live?ticket=pass" });
    expect(client.liveUrl).toHaveBeenCalledWith("u1");
  });

  it("refuses a Live ticket without a signed-in User", async () => {
    const { client, deps } = setup(null);

    expect((await handleLive(deps)).status).toBe(401);
    expect(client.liveUrl).not.toHaveBeenCalled();
  });

  it("refuses every call without a signed-in User and never reaches the service", async () => {
    const { client, deps } = setup(null);

    expect((await handleInbox(deps)).status).toBe(401);
    expect((await handleMarkRead("n1", deps)).status).toBe(401);
    expect((await handleMarkAllRead(deps)).status).toBe(401);
    expect(client.list).not.toHaveBeenCalled();
    expect(client.markRead).not.toHaveBeenCalled();
    expect(client.markAllRead).not.toHaveBeenCalled();
  });
});
