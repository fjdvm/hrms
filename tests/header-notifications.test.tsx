// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HeaderNotifications } from "@/components/layout/header-notifications";

type Item = { id: string; title: string; link: string | null; createdAt: string; read: boolean };
const application: Item = { id: "n2", title: "New application: Kristine Aquino", link: "/applicants/5", createdAt: "2026-11-02T08:00:00.000Z", read: false };
const posting: Item = { id: "n1", title: "Job posting closed: Cashier", link: "/job-postings/p1", createdAt: "2026-11-01T08:00:00.000Z", read: true };

let inbox: { available: boolean; unread: number; notifications: Item[] };
let fetchMock: ReturnType<typeof vi.fn>;
let sockets: FakeSocket[];
class FakeSocket {
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  onclose?: () => void;
  constructor(public url: string) { sockets.push(this); }
  close() { this.onclose?.(); }
}
const inboxCalls = () => fetchMock.mock.calls.filter(([url, init]) => url === "/api/notifications" && !init?.method).length;
const settle = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  inbox = { available: true, unread: 1, notifications: [application, posting] };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/notifications/live") return Response.json({ url: "wss://gateway.test/notifications/live?ticket=pass" });
    if (init?.method === "POST") return Response.json({ ok: true });
    return Response.json(inbox);
  });
  vi.stubGlobal("fetch", fetchMock);
  sockets = [];
  vi.stubGlobal("WebSocket", FakeSocket);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function renderBell(navigate = vi.fn()) {
  render(<HeaderNotifications navigate={navigate} />);
  await settle();
  return navigate;
}

it("shows the unread count from the server on load and hides the badge at zero", async () => {
  inbox.unread = 3;
  await renderBell();
  expect(screen.getByRole("button", { name: "Notifications, 3 unread" }).textContent).toContain("3");
  cleanup();
  inbox = { available: true, unread: 0, notifications: [posting] };
  await renderBell();
  expect(screen.getByRole("button", { name: "Notifications" }).textContent).toBe("");
});

it("opens one socket on the ticket address and shows a pushed Notification without a refresh", async () => {
  await renderBell();
  expect(sockets.map((s) => s.url)).toEqual(["wss://gateway.test/notifications/live?ticket=pass"]);
  inbox = { available: true, unread: 2, notifications: [{ ...application, id: "n3", title: "Job posting published: Recruiter" }, application, posting] };
  act(() => sockets[0].onmessage?.({ data: JSON.stringify({ type: "notification.created" }) }));
  await settle();
  expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBeTruthy();
});

it("makes no repeating requests while idle", async () => {
  await renderBell();
  const before = fetchMock.mock.calls.length;
  await settle(10 * 60_000);
  expect(fetchMock.mock.calls.length).toBe(before);
  expect(inboxCalls()).toBe(1);
});

it("refetches the current count when the socket opens and again after a reconnect", async () => {
  await renderBell();
  act(() => sockets[0].onopen?.());
  await settle();
  expect(inboxCalls()).toBe(2);
  inbox = { ...inbox, unread: 4 };
  act(() => sockets[0].onclose?.());
  await settle(60_000);
  expect(sockets).toHaveLength(2);
  act(() => sockets[1].onopen?.());
  await settle();
  expect(screen.getByRole("button", { name: "Notifications, 4 unread" })).toBeTruthy();
});

it("marks one read, persists it with the server, and follows its link", async () => {
  const navigate = await renderBell();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
  await user.click(screen.getByRole("button", { name: /New application: Kristine Aquino/ }));
  expect(fetchMock).toHaveBeenCalledWith("/api/notifications/n2/read", { method: "POST" });
  expect(navigate).toHaveBeenCalledWith("/applicants/5");
  expect(screen.getByRole("button", { name: "Notifications", hidden: true })).toBeTruthy();
});

it("marks all read with the server", async () => {
  await renderBell();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
  await user.click(screen.getByRole("button", { name: "Mark all read" }));
  expect(fetchMock).toHaveBeenCalledWith("/api/notifications/read-all", { method: "POST" });
  expect(screen.getByRole("button", { name: "Notifications", hidden: true })).toBeTruthy();
});

it("shows an unavailable state, and does not retry the socket, when signed out", async () => {
  inbox = { available: false, unread: 0, notifications: [] };
  fetchMock.mockImplementation(async (url: string) => url === "/api/notifications/live" ? new Response("{}", { status: 401 }) : Response.json(inbox));
  await renderBell();
  await settle(120_000);
  expect(sockets).toHaveLength(0);
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.click(screen.getByRole("button", { name: "Notifications" }));
  expect(screen.getByText("Notifications are unavailable right now.")).toBeTruthy();
});
