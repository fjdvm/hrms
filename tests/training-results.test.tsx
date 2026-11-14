// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MarkResults } from "@/components/training/mark-results";
import { TrainingCompletionCard } from "@/components/training/completion-card";
import { EditTrainingDialog } from "@/components/training/edit-training-dialog";
import { readResultMarks, type AssignedEmployee } from "@/lib/training-terms";

const actions = vi.hoisted(() => ({ saveResults: vi.fn(), updateTraining: vi.fn() }));
vi.mock("@/app/(hrms)/training/actions", () => actions);

const person = (id: number, name: string, extra: Partial<AssignedEmployee> = {}): AssignedEmployee => ({
  employeeId: id, name, position: "Production Staff", branch: "Main kitchen", email: `${name.split(" ")[0].toLowerCase()}@example.test`,
  needsPrintedSchedule: false, status: "Assigned", completedOn: null, reprintNeeded: false, ...extra,
});
const PEOPLE = [
  person(1, "Noel Garcia", { status: "Completed", completedOn: "2026-11-10" }),
  person(2, "Mark Lopez", { status: "Did not attend" }),
  person(3, "Lito Ramos"),
  person(4, "Cecil Robles"),
  person(5, "Gone Person", { status: "Cancelled" }),
];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  actions.saveResults.mockResolvedValue({ result: { marked: 1 } });
});
afterEach(() => { cleanup(); Object.values(actions).forEach((fn) => fn.mockReset()); vi.unstubAllGlobals(); });

const view = () => render(<MarkResults trainingId={7} trainingDate="2026-11-10" today="2026-11-14" people={PEOPLE} />);

it("counts marked results as 'X of Y' and leaves Cancelled employees out", () => {
  view();
  expect(screen.getByText("2 of 4")).toBeTruthy();
  expect(screen.queryByText("Gone Person")).toBeNull();
  expect(screen.getByRole("progressbar", { name: "Results marked" }).getAttribute("aria-valuenow")).toBe("2");
  expect(screen.getByText("Still Assigned").nextSibling?.textContent).toBe("2");
  expect(screen.queryByText(/attendance/i)).toBeNull();
});

it("marks one employee Completed with the Training's date, then Did not attend, and pressing it again returns to Assigned", async () => {
  view();
  const lito = screen.getByRole("group", { name: "Result for Lito Ramos" });
  await userEvent.click(within(lito).getByRole("button", { name: "Completed" }));
  expect((screen.getByLabelText("Completion date for Lito Ramos") as HTMLInputElement).value).toBe("2026-11-10");
  expect(screen.getByText("3 of 4")).toBeTruthy();
  await userEvent.click(within(lito).getByRole("button", { name: "Did not attend" }));
  expect(screen.queryByLabelText("Completion date for Lito Ramos")).toBeNull();
  await userEvent.click(within(lito).getByRole("button", { name: "Did not attend" }));
  expect(screen.getByText("2 of 4")).toBeTruthy();
});

it("marks the selected employees in bulk with a completion date", async () => {
  view();
  expect(screen.getByText("Select employees to mark them together")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Mark Completed" }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByLabelText("Select Lito Ramos"));
  await userEvent.click(screen.getByLabelText("Select Cecil Robles"));
  expect(screen.getByText("2 selected")).toBeTruthy();
  const date = screen.getByLabelText("Completion date for selected employees");
  await userEvent.clear(date);
  await userEvent.type(date, "2026-11-12");
  await userEvent.click(screen.getByRole("button", { name: "Mark Completed" }));
  expect(screen.getByText("4 of 4")).toBeTruthy();
  expect((screen.getByLabelText("Completion date for Cecil Robles") as HTMLInputElement).value).toBe("2026-11-12");
  expect(screen.getByText("Select employees to mark them together")).toBeTruthy();
});

it("selects everyone at once and marks them Did not attend", async () => {
  view();
  await userEvent.click(screen.getByLabelText("Select all employees"));
  expect(screen.getByText("4 selected")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Mark Did not attend" }));
  expect(screen.getByText("4 of 4")).toBeTruthy();
  expect(screen.getByText("Still Assigned").nextSibling?.textContent).toBe("0");
});

it("saves only what changed and says so", async () => {
  view();
  expect((screen.getByRole("button", { name: "Save results" }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(within(screen.getByRole("group", { name: "Result for Lito Ramos" })).getByRole("button", { name: "Completed" }));
  expect(screen.getByText("1 unsaved change")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Save results" }));
  expect(actions.saveResults).toHaveBeenCalledWith(7, [{ employeeId: 3, status: "Completed", completedOn: "2026-11-10" }]);
  expect((await screen.findByRole("status")).textContent).toBe("Results saved for 1 employee.");
  expect((screen.getByRole("button", { name: "Save results" }) as HTMLButtonElement).disabled).toBe(true);
});

it("shows the server's message when saving fails and keeps the changes", async () => {
  actions.saveResults.mockResolvedValueOnce({ error: "This training was cancelled, so results can't be marked." });
  view();
  await userEvent.click(within(screen.getByRole("group", { name: "Result for Lito Ramos" })).getByRole("button", { name: "Did not attend" }));
  await userEvent.click(screen.getByRole("button", { name: "Save results" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/was cancelled/);
  expect(screen.getByText("3 of 4")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Save results" }) as HTMLButtonElement).disabled).toBe(false);
});

it("checks marks like the server does", () => {
  const rule = { trainingDate: "2026-11-10", today: "2026-11-14" };
  expect(readResultMarks([{ employeeId: 3, status: "Completed", completedOn: "2026-11-12" }, { employeeId: 4, status: "Did not attend", completedOn: "2026-11-12" }], rule).marks)
    .toEqual([{ employeeId: 3, status: "Completed", completedOn: "2026-11-12" }, { employeeId: 4, status: "Did not attend", completedOn: null }]);
  for (const marks of [[], [{ employeeId: 3, status: "Completed" }], [{ employeeId: 3, status: "Completed", completedOn: "2026-11-09" }],
    [{ employeeId: 3, status: "Completed", completedOn: "2026-11-15" }], [{ employeeId: 3, status: "Cancelled" }], [{ employeeId: 3, status: "Did not attend" }, { employeeId: 3, status: "Assigned" }]]) {
    expect(readResultMarks(marks, rule).marks).toBeNull();
  }
});

it("shows Training completion as a whole percent with 'X of Y completed' and what still needs results", () => {
  render(<TrainingCompletionCard month="November 2026" completion={{ percent: 53, completed: 16, due: 30 }} needResults={[{ id: 9, title: "Safe lifting and ergonomics" }]} />);
  expect(screen.getByText("Training completion · November 2026")).toBeTruthy();
  expect(screen.getByText("53%")).toBeTruthy();
  expect(screen.getByText("16 of 30 completed")).toBeTruthy();
  expect(screen.getByText(/1 training still needs results: Safe lifting and ergonomics/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Mark results" }).getAttribute("href")).toBe("/training/9/results");
});

it("says 'Nothing to show yet', never 0%, when no Training was held this month", () => {
  render(<TrainingCompletionCard month="November 2026" completion={null} needResults={[]} />);
  expect(screen.getByText("Nothing to show yet")).toBeTruthy();
  expect(screen.queryByText(/%/)).toBeNull();
  expect(screen.queryByRole("link", { name: "Mark results" })).toBeNull();
});

const training = { title: "Safe lifting and ergonomics", trainer: "Safety Officer", description: "Lift safely.", objectives: "", date: "2026-11-10", startTime: "08:00", endTime: "09:30", mode: "In person" as const, location: "Main kitchen, Antipolo", rescheduledFrom: null };
const assigned = [{ name: "Noel Garcia", email: "noel@example.test" }];

it("locks the date, time and venue in the Edit dialog once results are recorded, and says why", async () => {
  actions.updateTraining.mockResolvedValue({ attempt: 1 });
  render(<EditTrainingDialog trainingId={7} training={training} assigned={assigned} lockedResults={5} />);
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  await screen.findByLabelText(/^Title/);
  expect(screen.getByText(/The date is locked because results are recorded for 5 employees\. To run it on another date, create a new training\./)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Create new training" }).getAttribute("href")).toBe("/training/new");
  for (const label of [/^Date/, /^Start time/, /^End time/, /^Venue/]) expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText("Date, time and venue can’t change after results are recorded.")).toBeTruthy();
  expect(screen.getByText(/Only the title, trainer, description, objectives and materials can change\./)).toBeTruthy();
  // The title stays editable and the locked schedule still travels with the form so the server sees it unchanged.
  expect((screen.getByLabelText(/^Title/) as HTMLInputElement).disabled).toBe(false);
  await userEvent.type(screen.getByLabelText(/^Title/), " 2");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(actions.updateTraining).toHaveBeenCalled());
  const data = actions.updateTraining.mock.calls[0][2] as FormData;
  expect(Object.fromEntries(["title", "date", "startTime", "endTime", "mode", "location"].map((name) => [name, data.get(name)])))
    .toEqual({ title: "Safe lifting and ergonomics 2", date: "2026-11-10", startTime: "08:00", endTime: "09:30", mode: "In person", location: "Main kitchen, Antipolo" });
});

it("leaves the schedule editable when no result is recorded", async () => {
  render(<EditTrainingDialog trainingId={7} training={training} assigned={assigned} />);
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  await screen.findByLabelText(/^Title/);
  expect(screen.queryByText(/The date is locked/)).toBeNull();
  expect((screen.getByLabelText(/^Date/) as HTMLInputElement).disabled).toBe(false);
});
