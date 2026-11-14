// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrintScheduleDialog } from "@/components/training/print-schedule-dialog";
import { SchedulePage } from "@/components/training/schedule-sheet";
import type { PrintableTraining, ScheduleSheet } from "@/lib/training-terms";

const actions = vi.hoisted(() => ({ loadPrintable: vi.fn(), loadSchedule: vi.fn(), recordSchedulePrinted: vi.fn() }));
vi.mock("@/app/(hrms)/training/actions", () => actions);

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const TRAININGS: PrintableTraining[] = [
  { id: 1, title: "New hire orientation", trainer: "HR", date: day(1), startTime: "08:00", endTime: "09:00", mode: "Online" },
  { id: 2, title: "Food safety and hygiene refresher", trainer: "QA Manager", date: day(3), startTime: "09:00", endTime: "11:00", mode: "In person" },
  { id: 3, title: "Far away training", trainer: "HR", date: day(40), startTime: "09:00", endTime: "11:00", mode: "In person" },
];
const sheetFor = (ids: number[], includeNames: boolean): ScheduleSheet => ({
  printedOn: "2026-11-14", printedBy: "Jude Nitram", includeNames,
  items: TRAININGS.filter((t) => ids.includes(t.id)).map((t) => ({ ...t, location: "Main kitchen", assignedCount: 2, assigned: includeNames ? ["Noel Garcia", "Mylene Santos"] : null })),
  needPrinted: includeNames ? [{ employeeId: 5, name: "Mylene Santos" }] : [{ employeeId: 5, name: "Mylene Santos" }],
});

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("print", vi.fn());
  actions.loadPrintable.mockResolvedValue({ trainings: TRAININGS });
  actions.loadSchedule.mockImplementation(async (ids: number[], names: boolean) => ({ sheet: sheetFor(ids, names) }));
  actions.recordSchedulePrinted.mockResolvedValue({ marked: 1 });
});
afterEach(() => { cleanup(); Object.values(actions).forEach((fn) => fn.mockReset()); vi.unstubAllGlobals(); vi.useRealTimers(); });

const open = async (props: { preselect?: number[]; triggerLabel?: string } = {}) => {
  render(<PrintScheduleDialog {...props} />);
  await userEvent.click(screen.getByRole("button", { name: props.triggerLabel ?? "Print schedule" }));
  await screen.findByRole("checkbox", { name: "New hire orientation" });
};
const checked = (name: string) => (screen.getByRole("checkbox", { name }) as HTMLInputElement).checked;

it("lists the upcoming Trainings and ticks the ones in the next 7 days", async () => {
  await open();
  expect(checked("New hire orientation")).toBe(true);
  expect(checked("Food safety and hygiene refresher")).toBe(true);
  expect(checked("Far away training")).toBe(false);
  expect(screen.getByText("2 trainings · with names")).toBeTruthy();
});

it("ticks only the chosen Training when opened from a training page", async () => {
  await open({ preselect: [2], triggerLabel: "Reprint schedule" });
  expect(checked("New hire orientation")).toBe(false);
  expect(checked("Food safety and hygiene refresher")).toBe(true);
  expect(screen.getByText("1 training · with names")).toBeTruthy();
});

it("shows the A4 preview with the date range, who printed it and the assigned names, and warns who needs a printed schedule", async () => {
  await open({ preselect: [2] });
  expect(await screen.findByText(/A4 preview · 1 of 1/)).toBeTruthy();
  expect(screen.getAllByText(/Printed 14 Nov 2026 by Jude Nitram/)).toHaveLength(2); // the preview and the copy that prints
  expect(screen.getAllByText(/Assigned \(2\): Noel Garcia, Mylene Santos/).length).toBeGreaterThan(0);
  expect(screen.getByText("1 employee on these trainings needs a printed schedule: Mylene Santos.")).toBeTruthy();
});

it("updates the preview when a Training is ticked or names are turned off", async () => {
  await open({ preselect: [2] });
  await userEvent.click(screen.getByRole("checkbox", { name: "New hire orientation" }));
  await waitFor(() => expect(actions.loadSchedule).toHaveBeenLastCalledWith([2, 1], true));
  await userEvent.click(screen.getByRole("switch", { name: "Include assigned names" }));
  await waitFor(() => expect(actions.loadSchedule).toHaveBeenLastCalledWith([2, 1], false));
  expect(screen.getByText("2 trainings · without names")).toBeTruthy();
  expect(screen.getByText("Without the names, no one is marked as printed.")).toBeTruthy();
  expect(screen.queryByText(/Assigned \(2\)/)).toBeNull();
});

it("disables Print and Export until a Training is chosen", async () => {
  await open({ preselect: [2] });
  await userEvent.click(screen.getByRole("checkbox", { name: "Food safety and hygiene refresher" }));
  expect((screen.getByRole("button", { name: "Print" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Choose at least one training/)).toBeTruthy();
});

it("marks the no-email Employees as printed, says so, then opens the browser's print window", async () => {
  await open({ preselect: [2] });
  await screen.findByText(/A4 preview/);
  await userEvent.click(screen.getByRole("button", { name: "Print" }));
  await waitFor(() => expect(actions.recordSchedulePrinted).toHaveBeenCalledWith([2], true));
  expect(await screen.findByText("1 employee marked as printed.")).toBeTruthy();
  await waitFor(() => expect(window.print).toHaveBeenCalled());
});

it("does not open the print window when marking fails", async () => {
  actions.recordSchedulePrinted.mockResolvedValue({ error: "HRMS could not reach the Portal or database." });
  await open({ preselect: [2] });
  await screen.findByText(/A4 preview/);
  await userEvent.click(screen.getByRole("button", { name: "Print" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/could not reach/);
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(window.print).not.toHaveBeenCalled();
});

it("exports a spreadsheet for the Excel format, posting the chosen Trainings", async () => {
  const post = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["a,b"]) });
  vi.stubGlobal("fetch", post);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
  await open({ preselect: [2] });
  await screen.findByText(/A4 preview/);
  await userEvent.click(screen.getByRole("radio", { name: "Excel (.csv)" }));
  await userEvent.click(screen.getByRole("button", { name: "Export" }));
  await waitFor(() => expect(post).toHaveBeenCalled());
  expect(post.mock.calls[0][0]).toBe("/api/training-schedule");
  expect(JSON.parse(post.mock.calls[0][1].body)).toEqual({ trainingIds: [2], includeNames: true });
  expect(window.print).not.toHaveBeenCalled();
});

it("tells Staff how each format works", async () => {
  await open({ preselect: [2] });
  expect(screen.getByText(/set to A4/)).toBeTruthy();
  await userEvent.click(screen.getByRole("radio", { name: "PDF" }));
  expect(screen.getByText("Choose Save as PDF in the print window.")).toBeTruthy();
});

it("says so when there are no upcoming Trainings", async () => {
  actions.loadPrintable.mockResolvedValue({ trainings: [] });
  render(<PrintScheduleDialog />);
  await userEvent.click(screen.getByRole("button", { name: "Print schedule" }));
  expect(await screen.findByText(/No upcoming trainings/)).toBeTruthy();
});

it("lays out a long sheet over several pages", () => {
  const items = Array.from({ length: 7 }, (_, i) => ({ ...sheetFor([1], true).items[0], id: i + 1, title: `Training ${i + 1}` }));
  render(<SchedulePage sheet={{ ...sheetFor([1], true), items }} page={1} />);
  expect(screen.getByText("Training 6")).toBeTruthy();
  expect(screen.queryByText("Training 1")).toBeNull();
  expect(screen.getByText("Page 2 of 2")).toBeTruthy();
});
