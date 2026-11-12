// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecordResultDialog } from "@/components/hiring/interview-result";
import { ScheduleInterview } from "@/components/hiring/schedule-interview";

const saveInterview = vi.fn();
const recordInterviewResult = vi.fn();
vi.mock("@/app/(hrms)/applicants/[id]/actions", () => ({
  saveInterview: (...args: unknown[]) => saveInterview(...args),
  recordInterviewResult: (...args: unknown[]) => recordInterviewResult(...args),
}));

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); saveInterview.mockReset(); recordInterviewResult.mockReset(); vi.unstubAllGlobals(); });

const interviewers = [{ id: "s1", name: "Liza Bautista", colour: "#2563eb" }];
const booked = { id: 7, startsAt: new Date("2030-01-15T06:15:00Z"), endsAt: new Date("2030-01-15T06:45:00Z"), type: "Online" as const, interviewerName: "Liza Bautista", location: "", interviewerId: "s1", meetingLink: "https://meet.google.com/xqp-rtke-vbn", mapLink: null, province: null, city: null, address: null, privateNotes: null, score: null, result: null, resultEmailAt: null };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

function renderSchedule(onOptimistic = vi.fn()) {
  render(<ScheduleInterview applicationId={1} stage="Interview" interview={booked} applicantName="Ben Torres" applicantEmail="ben@example.com" jobTitle="Production Staff" location="Main kitchen" interviewers={interviewers} label="Reschedule" today="2026-11-12" onOptimistic={onOptimistic} />);
  return onOptimistic;
}

it("closes the Schedule dialog and shows the booking at once, before the server answers", async () => {
  const slow = deferred<{ saved: true }>();
  saveInterview.mockReturnValueOnce(slow.promise);
  const onOptimistic = renderSchedule();
  await userEvent.click(screen.getByRole("button", { name: "Reschedule" }));
  await userEvent.click(screen.getByRole("button", { name: "Schedule & send invite" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onOptimistic).toHaveBeenCalledWith(expect.objectContaining({ kind: "save", applicationId: 1, interview: expect.objectContaining({ interviewerName: "Liza Bautista", interviewerId: "s1" }) }));
  slow.resolve({ saved: true });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("reopens the Schedule dialog with what HR typed and the reason when the server refuses", async () => {
  saveInterview.mockResolvedValueOnce({ error: "Liza Bautista is already meeting Ella Mae Rivera.", conflicts: [{ applicantName: "Ella Mae Rivera", startsAt: "2030-01-15T06:00:00Z", endsAt: "2030-01-15T06:45:00Z" }], freeSlots: [] });
  renderSchedule();
  await userEvent.click(screen.getByRole("button", { name: "Reschedule" }));
  await userEvent.click(screen.getByRole("button", { name: "Schedule & send invite" }));
  expect((await screen.findByRole("alert")).textContent).toContain("already meeting Ella Mae Rivera");
  expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("14:15");
});

it("closes the result dialog and shows the result at once, then reopens it with the reason if refused", async () => {
  const slow = deferred<{ error: string }>();
  recordInterviewResult.mockReturnValueOnce(slow.promise);
  const onOptimistic = vi.fn();
  render(<RecordResultDialog applicationId={7} interviewId={3} applicantName="Mylene Santos" subtitle="Mylene Santos · Cashier" initialResult="Not passed" onOptimistic={onOptimistic} onClose={() => {}} />);
  await userEvent.type(screen.getByLabelText(/Interview notes/), "No show");
  await userEvent.click(screen.getByRole("button", { name: "Save result" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onOptimistic).toHaveBeenCalledWith({ kind: "result", applicationId: 7, result: "Not passed", score: 4, privateNotes: "No show" });
  slow.resolve({ error: "A result can only be recorded once the interview has started." });
  expect((await screen.findByRole("alert")).textContent).toContain("once the interview has started");
  expect((screen.getByLabelText(/Interview notes/) as HTMLTextAreaElement).value).toBe("No show");
});
