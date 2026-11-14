// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedbackDialog } from "@/components/training/feedback-dialog";
import { MarkResults } from "@/components/training/mark-results";
import { feedbackLabel, readFeedback, type AssignedEmployee } from "@/lib/training-terms";

const actions = vi.hoisted(() => ({ saveFeedback: vi.fn(), saveResults: vi.fn() }));
vi.mock("@/app/(hrms)/training/actions", () => actions);

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  actions.saveFeedback.mockResolvedValue({ feedback: { rating: 4, comments: "Clear demo." } });
  actions.saveResults.mockResolvedValue({ result: { marked: 1 } });
});
afterEach(() => { cleanup(); Object.values(actions).forEach((fn) => fn.mockReset()); vi.unstubAllGlobals(); });

const dialog = (feedback: { rating: number; comments: string } | null = null, onSaved = vi.fn()) => {
  render(<FeedbackDialog trainingId={7} employeeId={3} employeeName="Bryan Castillo" trainingTitle="Safe lifting and ergonomics" trainingDate="10 Nov 2026" feedback={feedback} onSaved={onSaved} />);
  return onSaved;
};
const openIt = async (name: RegExp) => { await userEvent.click(screen.getByRole("button", { name })); await screen.findByText("Typed from the paper feedback form"); };

it("opens from 'Record feedback' with the paper-form note, five stars, optional comments and who and what it is for", async () => {
  dialog();
  await openIt(/Record feedback for Bryan Castillo/);
  expect(screen.getByText("Bryan Castillo · Safe lifting and ergonomics · 10 Nov 2026")).toBeTruthy();
  expect(screen.getAllByRole("radio")).toHaveLength(5);
  expect(screen.getByText("(optional)")).toBeTruthy();
  expect(screen.getByText("Saved to the employee’s training history.")).toBeTruthy();
});

it("shows the chosen rating as 'N of 5 · Label' and saves rating and comments", async () => {
  const onSaved = dialog();
  await openIt(/Record feedback/);
  await userEvent.click(screen.getByRole("radio", { name: "4 of 5 · Good" }));
  expect(screen.getByText("4 of 5 · Good")).toBeTruthy();
  expect(screen.getByRole("radio", { name: "4 of 5 · Good" }).getAttribute("aria-checked")).toBe("true");
  await userEvent.type(screen.getByLabelText(/Comments/), "Clear demo.");
  await userEvent.click(screen.getByRole("button", { name: "Save feedback" }));
  expect(actions.saveFeedback).toHaveBeenCalledWith(7, 3, 4, "Clear demo.");
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ rating: 4, comments: "Clear demo." }));
  await waitFor(() => expect(screen.queryByText("Typed from the paper feedback form")).toBeNull());
});

it("requires a rating before anything is saved", async () => {
  dialog();
  await openIt(/Record feedback/);
  await userEvent.click(screen.getByRole("button", { name: "Save feedback" }));
  expect(screen.getByRole("alert").textContent).toBe("Choose a rating from 1 to 5 stars.");
  expect(actions.saveFeedback).not.toHaveBeenCalled();
});

it("shows the server's message beside the comments and keeps the dialog open", async () => {
  actions.saveFeedback.mockResolvedValueOnce({ commentsError: "Use up to 1000 characters for the comments, without < or >." });
  dialog();
  await openIt(/Record feedback/);
  await userEvent.click(screen.getByRole("radio", { name: "5 of 5 · Excellent" }));
  await userEvent.click(screen.getByRole("button", { name: "Save feedback" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/without < or >/);
  expect(screen.getByText("Typed from the paper feedback form")).toBeTruthy();
});

it("reopens recorded feedback to change it, starting from what was saved", async () => {
  dialog({ rating: 3, comments: "Too fast." });
  expect(screen.getByRole("button", { name: /3 of 5 recorded/ }).textContent).toBe("3 / 5 recorded");
  await openIt(/3 of 5 recorded/);
  expect(screen.getByText("3 of 5 · Average")).toBeTruthy();
  expect((screen.getByLabelText(/Comments/) as HTMLTextAreaElement).value).toBe("Too fast.");
});

it("checks feedback like the server does", () => {
  expect(readFeedback({ rating: 4, comments: "  Good \n\n demo " }).feedback).toEqual({ rating: 4, comments: "Good\ndemo" });
  expect(readFeedback({ rating: 5 }).feedback).toEqual({ rating: 5, comments: "" });
  for (const raw of [{ rating: 0 }, { rating: 6 }, { rating: 2.5 }, { rating: "3" }, {}, { rating: 3, comments: "<script>" }, { rating: 3, comments: "x".repeat(1001) }]) {
    expect(readFeedback(raw).feedback).toBeNull();
  }
  expect(feedbackLabel(1)).toBe("1 of 5 · Poor");
});

const person = (id: number, name: string, extra: Partial<AssignedEmployee> = {}): AssignedEmployee => ({
  employeeId: id, name, position: "Production Staff", branch: "Main kitchen", email: "x@example.test",
  needsPrintedSchedule: false, status: "Assigned", completedOn: null, reprintNeeded: false, feedback: null, ...extra,
});

it("shows a Feedback column on Mark results: recorded, to record, or a dash when the employee is not Completed", async () => {
  render(<MarkResults trainingId={7} trainingTitle="Safe lifting and ergonomics" trainingDate="2026-11-10" today="2026-11-14" people={[
    person(1, "Noel Garcia", { status: "Completed", completedOn: "2026-11-10", feedback: { rating: 4, comments: "" } }),
    person(2, "Bryan Castillo", { status: "Completed", completedOn: "2026-11-10" }),
    person(3, "Mark Lopez", { status: "Did not attend" }),
    person(4, "Lito Ramos"),
  ]} />);
  expect(screen.getByRole("columnheader", { name: "Feedback" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Feedback for Noel Garcia: 4 of 5 recorded/ }).textContent).toBe("4 / 5 recorded");
  expect(screen.getByRole("button", { name: "Record feedback for Bryan Castillo" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /feedback for Mark Lopez/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /feedback for Lito Ramos/i })).toBeNull();
  // Recording from the table updates the cell.
  await userEvent.click(screen.getByRole("button", { name: "Record feedback for Bryan Castillo" }));
  await userEvent.click(await screen.findByRole("radio", { name: "4 of 5 · Good" }));
  await userEvent.click(screen.getByRole("button", { name: "Save feedback" }));
  expect(await screen.findByRole("button", { name: /Feedback for Bryan Castillo: 4 of 5 recorded/ })).toBeTruthy();
});

it("offers feedback only once Completed is saved, and drops it when the result is changed", async () => {
  render(<MarkResults trainingId={7} trainingTitle="Safe lifting and ergonomics" trainingDate="2026-11-10" today="2026-11-14" people={[person(4, "Lito Ramos")]} />);
  await userEvent.click(within(screen.getByRole("group", { name: "Result for Lito Ramos" })).getByRole("button", { name: "Completed" }));
  expect(screen.queryByRole("button", { name: /feedback for Lito Ramos/i })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Save results" }));
  expect(await screen.findByRole("button", { name: "Record feedback for Lito Ramos" })).toBeTruthy();
});
