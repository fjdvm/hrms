import { expect, it } from "vitest";
import { applyToCalendar, applyToJobList, applyToProfileInterviews, PENDING_INTERVIEW_ID, type JobListState, type SavedInterview } from "@/lib/interview-optimistic";
import type { ApplicationInterview, CalendarInterview } from "@/lib/applications";

const saved: SavedInterview = {
  startsAt: new Date("2099-01-05T02:00:00Z"), endsAt: new Date("2099-01-05T03:00:00Z"), type: "Online", interviewerName: "Bea Santos", interviewerId: "bea",
  location: "", meetingLink: "https://meet.google.com/abc", mapLink: null, province: null, city: null, address: null,
};
const waiting = { id: 1, applicantName: "Ann", applicantEmail: "ann@x.test", interview: null };
const booked = { id: 2, applicantName: "Bo", applicantEmail: "bo@x.test", interview: { id: 9, startsAt: new Date("2099-01-04T02:00:00Z"), endsAt: new Date("2099-01-04T03:00:00Z"), type: "Online" as const, interviewerName: "Bea Santos" } };
const state = (tab: JobListState["tab"]): JobListState => ({ tab, rows: [waiting, booked], counts: { All: 2, "To schedule": 1, Scheduled: 1 } });

it("moves a booked row to Scheduled and shifts the counts", () => {
  const next = applyToJobList(state("All"), { kind: "save", applicationId: 1, interview: saved });
  expect(next.counts).toEqual({ All: 2, "To schedule": 0, Scheduled: 2 });
  expect(next.rows[0].interview).toMatchObject({ id: PENDING_INTERVIEW_ID, interviewerName: "Bea Santos" });
});

it("takes a booked row out of the To schedule tab", () => {
  const next = applyToJobList({ ...state("To schedule"), rows: [waiting], counts: { All: 2, "To schedule": 1, Scheduled: 1 } }, { kind: "save", applicationId: 1, interview: saved });
  expect(next.rows).toEqual([]);
  expect(next.counts["To schedule"]).toBe(0);
});

it("rescheduling keeps the counts and the Interview id", () => {
  const next = applyToJobList(state("All"), { kind: "save", applicationId: 2, interview: saved });
  expect(next.counts).toEqual({ All: 2, "To schedule": 1, Scheduled: 1 });
  expect(next.rows[1].interview).toMatchObject({ id: 9, startsAt: saved.startsAt });
});

it("a result takes the applicant off the list and out of the counts", () => {
  const next = applyToJobList(state("All"), { kind: "result", applicationId: 2, result: "Passed", score: 4, privateNotes: null });
  expect(next.rows.map((row) => row.id)).toEqual([1]);
  expect(next.counts).toEqual({ All: 1, "To schedule": 1, Scheduled: 0 });
});

it("ignores an Application that is not on the list", () => {
  const before = state("All");
  expect(applyToJobList(before, { kind: "save", applicationId: 99, interview: saved })).toBe(before);
});

const calendar = (id: number, applicationId: number): CalendarInterview => ({
  id, applicationId, applicantName: "Ann", jobPostingId: "j", jobPostingTitle: "Cashier", interviewerId: "bea", interviewerName: "Bea Santos", colour: "#111",
  type: "Online", startsAt: new Date("2099-01-04T02:00:00Z"), endsAt: new Date("2099-01-04T03:00:00Z"), meetingLink: null, mapLink: null, place: "", applicantEmail: "a@x.test",
  jobLocation: "Manila", province: null, city: null, address: null, location: "", status: "Scheduled",
});

it("shows a rescheduled Interview at its new time and a result as finished", () => {
  const moved = applyToCalendar([calendar(5, 1), calendar(6, 2)], { kind: "save", applicationId: 1, interview: saved });
  expect(moved[0]).toMatchObject({ startsAt: saved.startsAt, meetingLink: "https://meet.google.com/abc" });
  expect(moved[1].startsAt).toEqual(new Date("2099-01-04T02:00:00Z"));
  const done = applyToCalendar([calendar(5, 1)], { kind: "result", applicationId: 1, result: "Not passed", score: 2, privateNotes: null });
  expect(done[0].status).toBe("Not passed");
});

const profile = (result: ApplicationInterview["result"] = null): ApplicationInterview => ({
  id: 3, startsAt: saved.startsAt, endsAt: saved.endsAt, type: "Online", interviewerName: "Bea Santos", location: "", interviewerId: "bea", meetingLink: null, mapLink: null,
  province: null, city: null, address: null, privateNotes: null, score: result ? 3 : null, result, resultEmailAt: null,
});

it("the profile table adds a first booking, edits the live Interview and completes it on a result", () => {
  expect(applyToProfileInterviews([], { kind: "save", applicationId: 1, interview: saved })[0]).toMatchObject({ id: PENDING_INTERVIEW_ID, result: null });
  expect(applyToProfileInterviews([profile()], { kind: "save", applicationId: 1, interview: { ...saved, interviewerName: "Cy" } })).toMatchObject([{ id: 3, interviewerName: "Cy" }]);
  expect(applyToProfileInterviews([profile()], { kind: "result", applicationId: 1, result: "Passed", score: 5, privateNotes: "great" })).toMatchObject([{ result: "Passed", score: 5, privateNotes: "great" }]);
});
