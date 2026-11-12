import type { ApplicationInterview, CalendarInterview, InterviewJobRow, InterviewJobTab } from "./applications";

/** What HR just asked for, applied to the screen before the server answers. The server stays the authority: a refused save rolls it back. */
export type InterviewPatch =
  | { kind: "save"; applicationId: number; interview: SavedInterview }
  | { kind: "result"; applicationId: number; result: "Passed" | "Not passed"; score: number; privateNotes: string | null };

export type SavedInterview = Pick<ApplicationInterview, "startsAt" | "endsAt" | "type" | "interviewerName" | "interviewerId" | "location" | "meetingLink" | "mapLink" | "province" | "city" | "address">;

/** Marks an Interview HR has just booked and the server has not numbered yet. */
export const PENDING_INTERVIEW_ID = -1;

export type JobListState = { rows: InterviewJobRow[]; counts: Record<InterviewJobTab, number>; tab: InterviewJobTab };

const keepsInTab = (tab: InterviewJobTab, row: InterviewJobRow) =>
  tab === "All" || (tab === "To schedule" ? row.interview === null : row.interview !== null);

/** The By job list: booking moves a row from To schedule to Scheduled, a result takes the row off the list, counts follow. */
export function applyToJobList(state: JobListState, patch: InterviewPatch): JobListState {
  const row = state.rows.find((item) => item.id === patch.applicationId);
  if (!row) return state;
  const counts = { ...state.counts };
  let next: InterviewJobRow | null;
  if (patch.kind === "result") {
    next = null;
    counts.All -= 1;
    counts[row.interview ? "Scheduled" : "To schedule"] -= 1;
  } else {
    next = { ...row, interview: { id: row.interview?.id ?? PENDING_INTERVIEW_ID, startsAt: patch.interview.startsAt, endsAt: patch.interview.endsAt, type: patch.interview.type, interviewerName: patch.interview.interviewerName } };
    if (!row.interview) { counts["To schedule"] -= 1; counts.Scheduled += 1; }
  }
  const rows = state.rows.flatMap((item) => (item !== row ? [item] : next && keepsInTab(state.tab, next) ? [next] : []));
  return { rows, counts, tab: state.tab };
}

/** The Calendar: a move shows at its new time at once; a result greys the Interview and labels it. */
export function applyToCalendar(interviews: CalendarInterview[], patch: InterviewPatch): CalendarInterview[] {
  return interviews.map((item) => {
    if (item.applicationId !== patch.applicationId) return item;
    if (patch.kind === "result") return { ...item, status: patch.result };
    const { interview } = patch;
    const place = [interview.address, interview.city, interview.province].filter(Boolean).join(", ") || interview.location;
    return { ...item, ...interview, place, interviewerId: interview.interviewerId };
  });
}

/** The profile's Interviews table: a booking appears at the top, a move edits it in place, a result completes it. */
export function applyToProfileInterviews(interviews: ApplicationInterview[], patch: InterviewPatch): ApplicationInterview[] {
  if (patch.kind === "result") {
    return interviews.map((item) => item.result === null ? { ...item, result: patch.result, score: patch.score, privateNotes: patch.privateNotes } : item);
  }
  const existing = interviews.find((item) => item.result === null);
  if (existing) return interviews.map((item) => (item === existing ? { ...item, ...patch.interview } : item));
  return [{ id: PENDING_INTERVIEW_ID, ...patch.interview, privateNotes: null, score: null, result: null, resultEmailAt: null }, ...interviews];
}
