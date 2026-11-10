import { expect, it, vi } from "vitest";
import { createNotificationsClient } from "./notifications";

function setup() {
  const calls: { url: URL; method: string; body: unknown; auth: string | null }[] = [];
  const fetchMock = vi.fn(async (input: URL, init: RequestInit) => {
    calls.push({ url: input, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init.headers).get("authorization") });
    if (input.pathname.endsWith("/live-tickets")) return Response.json({ ticket: "t1" });
    if (input.pathname.endsWith("/unread-count")) return Response.json({ unread: 3 });
    if (input.pathname.endsWith("/notifications/notifications")) {
      return Response.json({ notifications: [{ id: 7, title: "T", body: "B", link: "/applicants/1", createdAt: "2026-11-01T00:00:00Z", readAt: null }] });
    }
    return Response.json({});
  });
  const client = createNotificationsClient({ baseUrl: "https://gateway.test/", callerKey: "k", app: "HRMS", fetch: fetchMock as unknown as typeof fetch });
  return { client, calls };
}

it("reads and marks only inside HRMS's own app for the given user", async () => {
  const { client, calls } = setup();
  expect(await client.unreadCount("u1")).toBe(3);
  expect(await client.list("u1")).toEqual([{ id: "7", title: "T", body: "B", link: "/applicants/1", createdAt: "2026-11-01T00:00:00Z", read: false }]);
  await client.markRead("u1", "7");
  await client.markAllRead("u1");
  expect(calls.every((call) => call.auth === "Bearer k")).toBe(true);
  expect(calls[0].url.searchParams.get("app")).toBe("HRMS");
  expect(calls[1].url.searchParams.get("userId")).toBe("u1");
  expect(calls[2].body).toEqual({ userId: "u1", app: "HRMS" });
  expect(calls[3].body).toEqual({ userId: "u1", app: "HRMS" });
});

it("turns a gateway ticket into a wss address", async () => {
  const { client } = setup();
  expect(await client.liveUrl("u1")).toBe("wss://gateway.test/notifications/live?ticket=t1");
});
