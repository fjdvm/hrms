// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ mark: vi.fn(), undo: vi.fn(), refresh: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/app/(hrms)/employee-onboarding/actions", () => ({ markNoAccountNeeded: mocks.mark, undoNoAccountNeeded: mocks.undo }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));

import { NoAccountNeededButton, UndoNoAccountNeededButton } from "@/components/employees/no-account-needed-buttons";
import { OnboardingLive } from "@/components/employees/onboarding-live";

const employee = { id: 7, name: "Ellaine Torres", startDate: "2026-11-10" };
beforeEach(() => { mocks.mark.mockResolvedValue({ ok: true }); mocks.undo.mockResolvedValue({ ok: true }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("asks before marking, explaining the start date and the undo, and changes nothing on Cancel", async () => {
  render(<NoAccountNeededButton employee={employee} />);
  await userEvent.click(screen.getByRole("button", { name: "No account needed" }));
  expect(screen.getByText("Mark Ellaine Torres as needing no account?")).toBeTruthy();
  expect(screen.getByText(/They become Active on their start date, 10 Nov 2026.*undo this until they are Active/)).toBeTruthy();
  expect(mocks.mark).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mocks.mark).not.toHaveBeenCalled();
  expect(screen.queryByText("Mark Ellaine Torres as needing no account?")).toBeNull();
});

it("marks the person on confirm, then closes, confirms with a toast and re-reads the list", async () => {
  render(<NoAccountNeededButton employee={employee} />);
  await userEvent.click(screen.getByRole("button", { name: "No account needed" }));
  await userEvent.click(screen.getByRole("button", { name: "Mark as no account needed" }));
  expect(mocks.mark).toHaveBeenCalledWith(7);
  await waitFor(() => expect(screen.queryByText("Mark Ellaine Torres as needing no account?")).toBeNull());
  expect(mocks.success).toHaveBeenCalledWith("Ellaine Torres marked as needing no account");
  expect(mocks.refresh).toHaveBeenCalled();
});

it("keeps the dialog open with the reason when the server refuses, and refreshes the stale row", async () => {
  mocks.mark.mockResolvedValue({ ok: false, error: "This person's account state has changed, or they are already Active. The list has been refreshed." });
  render(<NoAccountNeededButton employee={employee} />);
  await userEvent.click(screen.getByRole("button", { name: "No account needed" }));
  await userEvent.click(screen.getByRole("button", { name: "Mark as no account needed" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/already Active/);
  expect(screen.getByText("Mark Ellaine Torres as needing no account?")).toBeTruthy();
  expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.refresh).toHaveBeenCalled();
});

it("undoes on one click and re-reads the list; a refusal is shown and the list still re-reads", async () => {
  render(<UndoNoAccountNeededButton employee={employee} />);
  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(mocks.undo).toHaveBeenCalledWith(7);
  await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("Ellaine Torres is back to Not requested"));
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  mocks.undo.mockResolvedValue({ ok: false, error: "Already Active." });
  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Already Active."));
  expect(mocks.refresh).toHaveBeenCalledTimes(2);
});

it("re-reads the list when the live connection pushes, makes no request on its own, and stops listening when it leaves", async () => {
  const { unmount } = render(<OnboardingLive />);
  expect(mocks.refresh).not.toHaveBeenCalled();
  act(() => { window.dispatchEvent(new Event("hrms:live-notification")); });
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  unmount();
  act(() => { window.dispatchEvent(new Event("hrms:live-notification")); });
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});
