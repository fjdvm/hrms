// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InterviewResult } from "@/components/hiring/interview-result";
import { sendTimeOptions } from "@/lib/result-email-times";

const recordInterviewResult = vi.fn();
vi.mock("@/app/(hrms)/applicants/[id]/actions", () => ({ recordInterviewResult: (...args: unknown[]) => recordInterviewResult(...args) }));

beforeEach(() => {
  recordInterviewResult.mockResolvedValue({ recorded: 1 });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); recordInterviewResult.mockReset(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const row = (startsAt: Date) => render(<InterviewResult applicationId={7} interviewId={3} startsAt={startsAt} applicantName="Mylene Santos" subtitle="Mylene Santos · Branch Cashier" />);
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

it("keeps Passed and Not passed disabled before the start time", () => {
  row(new Date(Date.now() + 3_600_000));
  expect(button("Passed").disabled).toBe(true);
  expect(button("Not passed").disabled).toBe(true);
});

it("switches the buttons on at the start time without a reload", () => {
  vi.useFakeTimers();
  row(new Date(Date.now() + 60_000));
  expect(button("Passed").disabled).toBe(true);
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(button("Passed").disabled).toBe(false);
  expect(button("Not passed").disabled).toBe(false);
});

it("opens with the clicked result chosen and saves score, notes and the send time", async () => {
  row(new Date(Date.now() - 1000));
  await userEvent.click(button("Not passed"));
  await userEvent.type(screen.getByLabelText(/Interview notes/), "No show");
  await userEvent.click(screen.getByRole("button", { name: "Save result" }));
  const data = recordInterviewResult.mock.calls[0][3] as FormData;
  expect(recordInterviewResult.mock.calls[0].slice(0, 2)).toEqual([7, 3]);
  expect(data.get("result")).toBe("Not passed");
  expect(data.get("score")).toBe("4");
  expect(data.get("privateNotes")).toBe("No show");
  expect(String(data.get("resultEmailAt"))).toMatch(/T01:00:00\.000Z$/);
});

it("sends no email time when the email toggle is off", async () => {
  row(new Date(Date.now() - 1000));
  await userEvent.click(button("Passed"));
  await userEvent.click(screen.getByRole("switch", { name: /Email the result to Mylene/ }));
  await userEvent.click(screen.getByRole("button", { name: "Save result" }));
  expect((recordInterviewResult.mock.calls[0][3] as FormData).has("resultEmailAt")).toBe(false);
});

it("offers tomorrow 9:00 AM Manila time", () => {
  const options = sendTimeOptions(new Date("2026-11-12T03:00:00Z")); // 11:00 AM Manila
  expect(options.map((option) => option.label)).toEqual(["Today, 12 Nov · 6:00 PM", "Tomorrow, 13 Nov · 9:00 AM", "Sat, 14 Nov · 9:00 AM"]);
  expect(options[1].value).toBe("2026-11-13T01:00:00.000Z");
});
