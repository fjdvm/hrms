// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CancelTrainingDialog } from "@/components/training/cancel-dialog";
import { cancelledEmail, readCancelReason } from "@/lib/training-terms";

const actions = vi.hoisted(() => ({ cancelTraining: vi.fn() }));
vi.mock("@/app/(hrms)/training/actions", () => actions);

const PEOPLE = [
  { name: "Carla Mendoza", email: "carla@example.test" },
  { name: "Ellaine Torres", email: "ellaine@example.test" },
  { name: "Mylene Santos", email: null },
];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  actions.cancelTraining.mockResolvedValue({ result: { cancelled: 3, notified: 2, needPrintedSchedule: 1 } });
});
afterEach(() => { cleanup(); actions.cancelTraining.mockReset(); vi.unstubAllGlobals(); });

const open = async (people = PEOPLE) => {
  render(<CancelTrainingDialog trainingId={7} title="POS and cash handling" date="2026-11-20" subtitle="Fri, 20 Nov 2026 · 2:00 – 4:00 PM" people={people} />);
  await userEvent.click(screen.getByRole("button", { name: "Cancel training" }));
  await screen.findByText("Cancel training?");
};
const confirm = () => screen.getAllByRole("button", { name: "Cancel training" }).at(-1)!;

it("shows the notify toggle on, who gets an email, an email preview and what cancelling does", async () => {
  await open();
  expect(screen.getByRole("switch", { name: "Notify assigned employees" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText("2 get a Cancelled email. 1 without an email must be told directly.")).toBeTruthy();
  expect(screen.getByText("Cancelled: POS and cash handling on Fri, 20 Nov")).toBeTruthy();
  expect(screen.getByText(/Hi Carla,/)).toBeTruthy();
  expect(screen.getByText(/All 3 assigned employees will be set to Cancelled\. This can’t be undone/)).toBeTruthy();
});

it("warns when the toggle is turned off and hides the preview", async () => {
  await open();
  expect(screen.queryByText("If you turn this off, they may still show up.")).toBeNull();
  await userEvent.click(screen.getByRole("switch", { name: "Notify assigned employees" }));
  expect(screen.getByText("If you turn this off, they may still show up.")).toBeTruthy();
  expect(screen.queryByText("Email preview")).toBeNull();
});

it("requires a reason: nothing is cancelled until one is typed", async () => {
  await open();
  await userEvent.click(confirm());
  expect(screen.getByRole("alert").textContent).toBe("Enter a reason for cancelling.");
  expect(actions.cancelTraining).not.toHaveBeenCalled();
});

it("cancels with the reason and the notify choice, then closes", async () => {
  await open();
  await userEvent.type(screen.getByLabelText(/Reason/), "Trainer unavailable.");
  expect(screen.getByText(/Reason: Trainer unavailable\./)).toBeTruthy();
  await userEvent.click(screen.getByRole("switch", { name: "Notify assigned employees" }));
  await userEvent.click(confirm());
  expect(actions.cancelTraining).toHaveBeenCalledWith(7, "Trainer unavailable.", false);
  await waitFor(() => expect(screen.queryByText("Cancel training?")).toBeNull());
});

it("keeps the dialog open and shows the server's message when cancelling fails or the reason is refused", async () => {
  actions.cancelTraining.mockResolvedValueOnce({ error: "This training was already cancelled or has results recorded, so it can't be cancelled." });
  await open();
  await userEvent.type(screen.getByLabelText(/Reason/), "Trainer unavailable.");
  await userEvent.click(confirm());
  expect((await screen.findByRole("alert")).textContent).toMatch(/already cancelled/);
  expect(screen.getByText("Cancel training?")).toBeTruthy();
});

it("Keep training closes the dialog without cancelling", async () => {
  await open();
  await userEvent.click(screen.getByRole("button", { name: "Keep training" }));
  await waitFor(() => expect(screen.queryByText("Cancel training?")).toBeNull());
  expect(actions.cancelTraining).not.toHaveBeenCalled();
});

it("copes with a Training that has no one assigned", async () => {
  await open([]);
  expect(screen.getByText("No one is assigned, so no email will be sent.")).toBeTruthy();
  expect(screen.getByText(/No one is assigned yet\. This can’t be undone/)).toBeTruthy();
});

it("reads the reason like the form does and builds the Cancelled email", () => {
  expect(readCancelReason("  Trainer \n\n unavailable ")).toEqual({ reason: "Trainer\nunavailable" });
  expect(readCancelReason("").error).toBeTruthy();
  expect(readCancelReason("<script>").reason).toBeNull();
  const email = cancelledEmail("Carla Mendoza", { title: "POS and cash handling", date: "2026-11-20" }, "Trainer unavailable.");
  expect(email.title).toBe("Cancelled: POS and cash handling on Fri, 20 Nov");
  expect(email.body).toContain("Reason: Trainer unavailable.");
});
