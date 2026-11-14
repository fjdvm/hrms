// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationLogView } from "@/components/training/notification-log";
import { NotificationLogPreview, eventSummary } from "@/components/training/notification-log-preview";
import { LOG_TABS, logTabFromParam, type LogRow, type NotificationLog } from "@/lib/training-terms";

const actions = vi.hoisted(() => ({ retryTrainingNotice: vi.fn() }));
vi.mock("@/app/(hrms)/training/actions", () => actions);

const row = (extra: Partial<LogRow>): LogRow => ({
  noticeId: 1, employeeId: 1, employeeName: "Carla Mendoza", position: "Branch Cashier", branch: "Taytay branch", kind: "Schedule changed", email: "carla@example.test",
  state: "Sent", at: "2026-11-11T08:10:00Z", attempts: 0, nextAttemptAt: null, ...extra,
});
const log = (rows: LogRow[]): NotificationLog => ({
  rows, notReached: rows.filter((r) => r.state === "Failed"), needsPrinted: rows.filter((r) => r.state === "Needs printed schedule"),
  counts: { "All notices": rows.length, "Not reached": rows.filter((r) => r.state === "Failed").length, "Needs printed schedule": rows.filter((r) => r.state === "Needs printed schedule").length },
});
const ROWS = [
  row({ noticeId: 4, employeeId: 4, employeeName: "Grace Villar", email: "grace@example.test", state: "Failed", attempts: 4, at: "2026-11-11T08:55:00Z" }),
  row({ noticeId: 3, employeeId: 3, employeeName: "Kristine Aquino", email: "kristine@example.test", state: "Retrying", attempts: 2, nextAttemptAt: "2026-11-11T08:40:00Z", at: "2026-11-11T08:25:00Z" }),
  row({}),
  row({ noticeId: null, employeeId: 5, employeeName: "Mylene Santos", email: null, kind: "Assignment", state: "Needs printed schedule", at: "2026-11-09T02:00:00Z" }),
];

beforeEach(() => actions.retryTrainingNotice.mockResolvedValue({}));
afterEach(() => { cleanup(); actions.retryTrainingNotice.mockReset(); });

it("lists a row per notice with its state, Try N of 3 and the next time, and No email for printed-schedule Employees", () => {
  render(<NotificationLogView trainingId={7} log={log(ROWS)} tab="All notices" />);
  expect(screen.getAllByText("Sent").length).toBeGreaterThan(0);
  expect(screen.getByText("4 tries · moved to Not reached")).toBeTruthy();
  expect(screen.getByText(/Try 2 of 3 · next at 4:40 PM/)).toBeTruthy();
  expect(screen.getByText("No email")).toBeTruthy();
  expect(screen.getAllByText("Needs printed schedule").length).toBeGreaterThan(0);
});

it("shows the three tabs with counts, linking to each", () => {
  render(<NotificationLogView trainingId={7} log={log(ROWS)} tab="All notices" />);
  expect(screen.getByRole("link", { name: "All notices 4" }).getAttribute("href")).toBe("/training/7/log");
  expect(screen.getByRole("link", { name: "Not reached 1" }).getAttribute("href")).toBe("/training/7/log?tab=not-reached");
  expect(screen.getByRole("link", { name: "Needs printed schedule 1" }).getAttribute("href")).toBe("/training/7/log?tab=needs-printed-schedule");
  expect(LOG_TABS.map((tab) => logTabFromParam(tab.toLowerCase().replace(/ /g, "-")))).toEqual(LOG_TABS);
  expect(logTabFromParam("nonsense")).toBe("All notices");
});

it("lists Not reached Employees with Retry, and retries on click", async () => {
  render(<NotificationLogView trainingId={7} log={log(ROWS)} tab="Not reached" />);
  expect(screen.getByText("Not reached · 1")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Retry Grace Villar" }));
  await waitFor(() => expect(actions.retryTrainingNotice).toHaveBeenCalledWith(7, 4));
});

it("lists the Needs printed schedule Employees separately, with no Retry", () => {
  render(<NotificationLogView trainingId={7} log={log([ROWS[3]])} tab="Needs printed schedule" />);
  expect(screen.getByText("Needs printed schedule · 1")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it("says there are no notices yet on an empty log", () => {
  render(<NotificationLogView trainingId={7} log={log([])} tab="All notices" />);
  expect(screen.getByText(/No notices yet/)).toBeTruthy();
});

it("previews the latest events with a View all link", () => {
  const events = [{ kind: "Assignment", at: "2026-11-09T02:02:00Z", sent: 4, retrying: 0, failed: 0, needPrinted: 2 }];
  expect(eventSummary(events[0])).toBe("4 sent · 2 need printed schedule");
  render(<NotificationLogPreview trainingId={7} events={events} />);
  expect(screen.getByText("Assignment")).toBeTruthy();
  expect(screen.getByRole("link", { name: "View all" }).getAttribute("href")).toBe("/training/7/log");
  cleanup();
  render(<NotificationLogPreview trainingId={7} events={[]} />);
  expect(screen.getByText(/No notices yet/)).toBeTruthy();
});
