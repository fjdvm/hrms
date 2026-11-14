// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditTrainingDialog } from "@/components/training/edit-training-dialog";
import { AssignedEmployees } from "@/components/training/assigned-employees";

const actions = vi.hoisted(() => ({ updateTraining: vi.fn(), removeAssignedEmployee: vi.fn() }));
vi.mock("@/app/(hrms)/training/actions", () => actions);

const training = { title: "POS and cash handling", trainer: "HR", description: "Count cash.", objectives: "", date: "2099-11-20", startTime: "14:00", endTime: "16:00", mode: "Online" as const, location: "https://meet.example.test/pos", rescheduledFrom: null };
const assigned = [{ name: "Carla Mendoza", email: "carla@example.test" }, { name: "Ana Dizon", email: "ana@example.test" }, { name: "Mylene Santos", email: null }];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  actions.updateTraining.mockResolvedValue({ result: { changed: true, rescheduled: true, notified: 2, needPrintedSchedule: 1 }, attempt: 1 });
});
afterEach(() => { cleanup(); Object.values(actions).forEach((fn) => fn.mockReset()); vi.unstubAllGlobals(); });

const open = async () => {
  render(<EditTrainingDialog trainingId={7} training={training} assigned={assigned} />);
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
  await screen.findByLabelText(/^Title/);
};
const setDate = async (value: string) => { const input = screen.getByLabelText(/^Date/); await userEvent.clear(input); await userEvent.type(input, value); };

it("opens with the Training's current values and no Before/After until the schedule changes", async () => {
  await open();
  expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("POS and cash handling");
  expect((screen.getByLabelText(/^Date/) as HTMLInputElement).value).toBe("2099-11-20");
  expect(screen.queryByTestId("before-after")).toBeNull();
  expect(screen.queryByText("Notify assigned employees")).toBeNull();
});

it("shows old and new date, time and venue side by side once the schedule changes", async () => {
  await open();
  await setDate("2099-11-27");
  const block = await screen.findByTestId("before-after");
  expect(block.textContent).toContain("Before");
  expect(block.textContent).toContain("Fri, 20 Nov 2099");
  expect(block.textContent).toContain("Fri, 27 Nov 2099");
  expect(screen.getByText(/Status stays Upcoming/).textContent).toContain("Rescheduled from 20 Nov 2099");
});

it("has Notify ON by default with the counts and an email preview", async () => {
  await open();
  await setDate("2099-11-27");
  const toggle = screen.getByRole("switch", { name: "Notify assigned employees" });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText(/2 get a Schedule changed email\. 1 without an email need a reprinted schedule\./)).toBeTruthy();
  expect(screen.getByText("EMAIL PREVIEW")).toBeTruthy();
  expect(screen.getByText("Schedule changed: POS and cash handling")).toBeTruthy();
  expect(screen.getByText(/Hi Carla,/)).toBeTruthy();
});

it("warns when Notify is turned off and sends notify=0", async () => {
  await open();
  await setDate("2099-11-27");
  await userEvent.click(screen.getByRole("switch", { name: "Notify assigned employees" }));
  expect(screen.getByText("If you turn this off, they won’t know about the new date.")).toBeTruthy();
  expect(screen.queryByText("EMAIL PREVIEW")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(actions.updateTraining).toHaveBeenCalled());
  const data = actions.updateTraining.mock.calls[0][2] as FormData;
  expect(data.get("notify")).toBe("0");
  expect(data.get("date")).toBe("2099-11-27");
  expect(actions.updateTraining.mock.calls[0][0]).toBe(7);
});

it("sends notify=1 by default and closes once saved", async () => {
  await open();
  await setDate("2099-11-27");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(screen.queryByLabelText(/^Title/)).toBeNull());
  expect((actions.updateTraining.mock.calls[0][2] as FormData).get("notify")).toBe("1");
});

it("shows server field errors and keeps the dialog open", async () => {
  actions.updateTraining.mockResolvedValue({ fieldErrors: { title: "Enter a title." }, attempt: 1 });
  await open();
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect((await screen.findByText("Enter a title.")).getAttribute("role")).toBe("alert");
  expect(screen.getByLabelText(/^Title/)).toBeTruthy();
});

it("a text-only edit shows no Notify section", async () => {
  await open();
  await userEvent.type(screen.getByLabelText(/^Title/), " 2");
  expect(screen.queryByText("Notify assigned employees")).toBeNull();
});

it("flags a no-email Employee 'Reprint needed' in the Assigned employees table", () => {
  const person = (id: number, name: string, email: string | null, reprintNeeded: boolean) => ({ employeeId: id, name, position: "Cashier", branch: "Taytay", email, needsPrintedSchedule: !email, status: "Assigned" as const, completedOn: null, reprintNeeded, feedback: null });
  render(<AssignedEmployees trainingId={7} title="POS" date="d" people={[person(1, "Mylene Santos", null, true), person(2, "Joel Ramirez", null, false)]} />);
  expect(screen.getAllByText("Needs printed schedule")).toHaveLength(2);
  expect(screen.getAllByText("Reprint needed")).toHaveLength(1);
});
