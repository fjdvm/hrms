// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmployeeTabs } from "@/components/employees/employee-tabs";
import { EmployeePicker } from "@/components/training/employee-picker";
import { HistoryTable, ProfileTrainingHistory, TrainingHistoryView } from "@/components/training/training-history";
import { HISTORY_TABS, historyRowsFor, type HistoryRow, type HistoryTab, type TrainingHistory } from "@/lib/training-terms";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => { cleanup(); push.mockReset(); });

const row = (id: number, title: string, result: HistoryRow["result"], extra: Partial<HistoryRow> = {}): HistoryRow => ({
  trainingId: id, title, trainer: "QA Manager", date: "2026-11-19", startTime: "10:00", endTime: "11:30", mode: "In person", result, completedOn: null,
  resultsNotRecorded: false, upcoming: result === "Assigned", ...extra,
});
const ROWS = [
  row(1, "Halaya batch quality checks", "Assigned"),
  row(2, "Allergen labeling", "Cancelled", { upcoming: false }),
  row(3, "Safe lifting and ergonomics", "Completed", { completedOn: "2026-11-10", date: "2026-11-10" }),
  row(4, "Knife handling basics", "Did not attend", { date: "2026-09-14", upcoming: false }),
  row(5, "Past, no result", "Assigned", { upcoming: false, resultsNotRecorded: true, date: "2026-11-01" }),
];
const history: TrainingHistory = {
  employee: { id: 9, name: "Noel Garcia", employeeNumber: "BR-EMP-0055", position: "Production Staff", branch: "Main kitchen, Antipolo", status: "Active" },
  rows: ROWS,
  counts: Object.fromEntries(HISTORY_TABS.map((tab) => [tab, historyRowsFor(ROWS, tab as HistoryTab).length])) as TrainingHistory["counts"],
};

it("shows the Employee, their number, position and branch, and the four counts", () => {
  render(<TrainingHistoryView history={history} tab="All" />);
  expect(screen.getByText("Noel Garcia")).toBeTruthy();
  expect(screen.getByText("BR-EMP-0055 · Production Staff · Main kitchen, Antipolo")).toBeTruthy();
  for (const [label, value] of [["Assigned", "5"], ["Completed", "1"], ["Did not attend", "1"], ["Upcoming", "1"]]) {
    const term = screen.getAllByText(label).find((element) => element.tagName === "DT")!;
    expect(term.nextElementSibling?.textContent).toBe(value);
  }
});

it("links each tab with its count to the same Employee", () => {
  render(<TrainingHistoryView history={history} tab="All" />);
  expect(screen.getByRole("link", { name: "All 5" }).getAttribute("href")).toBe("/training/history?employee=9");
  expect(screen.getByRole("link", { name: "Upcoming 1" }).getAttribute("href")).toBe("/training/history?employee=9&tab=upcoming");
  expect(screen.getByRole("link", { name: "Did not attend 1" }).getAttribute("href")).toBe("/training/history?employee=9&tab=did-not-attend");
  expect(screen.getByRole("link", { name: "All 5" }).getAttribute("aria-current")).toBe("page");
});

it("shows only the chosen tab's rows", () => {
  render(<TrainingHistoryView history={history} tab="Completed" />);
  expect(screen.getByText("Safe lifting and ergonomics")).toBeTruthy();
  expect(screen.queryByText("Allergen labeling")).toBeNull();
});

it("links each Training, shows Completed with its completion date, and flags a result not yet recorded", () => {
  render(<HistoryTable rows={ROWS} empty="none" />);
  expect(screen.getByRole("link", { name: "Safe lifting and ergonomics" }).getAttribute("href")).toBe("/training/3");
  const completed = screen.getByText("Safe lifting and ergonomics").closest("tr")!;
  expect(within(completed).getByText("Completed")).toBeTruthy();
  expect(within(completed).getByText("10 Nov 2026")).toBeTruthy();
  expect(within(screen.getByText("Past, no result").closest("tr")!).getByText("Results not recorded")).toBeTruthy();
  expect(within(screen.getByText("Knife handling basics").closest("tr")!).getByText("Did not attend")).toBeTruthy();
});

it("says so when there are no Trainings, and when a tab is empty", () => {
  render(<TrainingHistoryView history={{ ...history, rows: [], counts: { All: 0, Upcoming: 0, Completed: 0, "Did not attend": 0, Cancelled: 0 } }} tab="All" />);
  expect(screen.getByText(/No trainings yet/)).toBeTruthy();
  cleanup();
  render(<TrainingHistoryView history={{ ...history, rows: [ROWS[0]] }} tab="Cancelled" />);
  expect(screen.getByText("Nothing in this list.")).toBeTruthy();
});

it("shows the profile tab with its counts, the table and a link to the full Training history", () => {
  render(<ProfileTrainingHistory history={history} />);
  expect(screen.getByText(/5 assigned · 1 completed · 1 did not attend · 1 upcoming/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open in Training history" }).getAttribute("href")).toBe("/training/history?employee=9");
  expect(screen.getByText("Halaya batch quality checks")).toBeTruthy();
});

it("goes to the chosen Employee's history from the picker", async () => {
  render(<EmployeePicker employees={[{ id: 9, name: "Noel Garcia", employeeNumber: "BR-EMP-0055" }, { id: 4, name: "Ana Dizon", employeeNumber: "BR-EMP-0004" }]} selected={null} />);
  await userEvent.selectOptions(screen.getByLabelText("Employee"), "4");
  expect(push).toHaveBeenCalledWith("/training/history?employee=4");
  await userEvent.selectOptions(screen.getByLabelText("Employee"), "");
  expect(push).toHaveBeenLastCalledWith("/training/history");
});


it("adds a Training history tab to the Employee profile only when the Staff member may see it", () => {
  const tabs = (training?: React.ReactNode) => <EmployeeTabs documentCount={2} details="d" documents="x" history="h" activity="a" training={training} />;
  render(tabs());
  expect(screen.queryByRole("tab", { name: "Training history" })).toBeNull();
  cleanup();
  render(tabs(<p>history body</p>));
  expect(screen.getByRole("tab", { name: "Training history" })).toBeTruthy();
});
