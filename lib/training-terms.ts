// Training terms and their rules. No database or server imports, so the form (a client component) can use it.

export const TRAINING_MODES = ["Online", "In person"] as const;
export type TrainingMode = (typeof TRAINING_MODES)[number];
export const TRAINING_STATUSES = ["Upcoming", "Completed", "Cancelled"] as const;
export type TrainingStatus = (typeof TRAINING_STATUSES)[number];
export const TRAINING_TABS = ["All", "Upcoming", "Past", "Cancelled"] as const;
export type TrainingTab = (typeof TRAINING_TABS)[number];

/** What Staff fill in. `date` is "YYYY-MM-DD" and the times are "HH:mm", all Manila wall-clock. */
export type TrainingTerms = {
  title: string;
  trainer: string;
  description: string;
  objectives: string;
  date: string;
  startTime: string;
  endTime: string;
  mode: TrainingMode;
  /** A meeting link when Online, a venue when In person. */
  location: string;
};
export const TERM_FIELDS = ["title", "trainer", "description", "objectives", "date", "startTime", "endTime", "mode", "location"] as const;
export type TrainingFormErrors = Partial<Record<(typeof TERM_FIELDS)[number], string>>;

export const manilaToday = (now: Date = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

/**
 * Status is derived, never chosen: Cancelled once cancelled, Completed once the Training's date has passed
 * (in Manila time), Upcoming otherwise, including on the day itself.
 */
export function trainingStatus(training: { date: string; cancelled: boolean }, now: Date = new Date()): TrainingStatus {
  if (training.cancelled) return "Cancelled";
  return training.date < manilaToday(now) ? "Completed" : "Upcoming";
}

/** The tab a status counts under. */
export const tabOf = (status: TrainingStatus): Exclude<TrainingTab, "All"> => (status === "Completed" ? "Past" : status);

export const isDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  // An impossible date such as 2026-13-40 is an Invalid Date, whose toISOString throws.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
};
const isTime = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
// Letters, digits, spaces and the punctuation titles and names use; control characters and markup are rejected, not stripped.
const TEXT = /^[^\p{Cc}<>]*$/u;
const LINK = /^https?:\/\/[^\s<>]+$/i;

/** One line of text: trimmed, inner whitespace collapsed. */
export const cleanLine = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
/** Several lines: trimmed per line, blank lines dropped. */
export const cleanLines = (value: unknown) =>
  typeof value === "string" ? value.split(/\r?\n/).map((line) => line.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n") : "";

/** Normalises what the form sent, then reports every problem. `terms` is set only when there is none. */
export function readTrainingForm(raw: Record<string, string>, today = manilaToday(), { currentDate }: { currentDate?: string } = {}): { terms: TrainingTerms | null; errors: TrainingFormErrors } {
  const terms: TrainingTerms = {
    title: cleanLine(raw.title),
    trainer: cleanLine(raw.trainer),
    description: cleanLines(raw.description),
    objectives: cleanLines(raw.objectives),
    date: (raw.date ?? "").trim(),
    startTime: (raw.startTime ?? "").trim(),
    endTime: (raw.endTime ?? "").trim(),
    mode: raw.mode as TrainingMode,
    location: cleanLine(raw.location),
  };
  const errors: TrainingFormErrors = {};
  if (!terms.title) errors.title = "Enter a title.";
  else if (terms.title.length > 120 || !TEXT.test(terms.title)) errors.title = "Use up to 120 letters, numbers and punctuation, without < or >.";
  if (!terms.trainer) errors.trainer = "Enter the trainer.";
  else if (terms.trainer.length > 80 || !TEXT.test(terms.trainer)) errors.trainer = "Use up to 80 characters for the trainer, without < or >.";
  if (terms.description.length > 2000 || !TEXT.test(terms.description.replace(/\n/g, " "))) errors.description = "Use up to 2000 characters, without < or >.";
  if (terms.objectives.length > 2000 || !TEXT.test(terms.objectives.replace(/\n/g, " "))) errors.objectives = "Use up to 2000 characters, without < or >.";
  if (!isDate(terms.date)) errors.date = "Choose a date.";
  // Editing may keep a date that has since passed (to fix a typo afterwards); moving to a new date must be today or later.
  else if (terms.date < today && terms.date !== currentDate) errors.date = "The date can't be in the past.";
  if (!isTime(terms.startTime)) errors.startTime = "Choose a start time.";
  if (!isTime(terms.endTime)) errors.endTime = "Choose an end time.";
  else if (isTime(terms.startTime) && terms.endTime <= terms.startTime) errors.endTime = "The end time must be after the start time.";
  if (!TRAINING_MODES.includes(terms.mode)) errors.mode = "Choose Online or In person.";
  const place = terms.mode === "Online" ? "meeting link" : "venue";
  if (!terms.location) errors.location = `Enter the ${place}.`;
  else if (terms.location.length > 300 || !TEXT.test(terms.location)) errors.location = `Use up to 300 characters for the ${place}, without < or >.`;
  else if (terms.mode === "Online" && !LINK.test(terms.location)) errors.location = "Enter a link starting with https://.";
  return { terms: Object.keys(errors).length === 0 ? terms : null, errors };
}

/** "Mon, 16 Nov 2026" */
export const formatTrainingDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .replace(/^(\w{3}) /, "$1, ");
/** "8:00 – 9:00 AM", or "11:00 AM – 1:00 PM" when the two sides differ. */
export function formatTrainingTimes(start: string, end: string) {
  const part = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    return { text: `${h % 12 || 12}:${String(m).padStart(2, "0")}`, meridiem: h < 12 ? "AM" : "PM" };
  };
  const a = part(start), b = part(end);
  return a.meridiem === b.meridiem ? `${a.text} – ${b.text} ${b.meridiem}` : `${a.text} ${a.meridiem} – ${b.text} ${b.meridiem}`;
}
/** "13 Nov 2026" */
export const formatShortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function trainingTabFromParam(param: string | undefined): TrainingTab {
  return TRAINING_TABS.find((tab) => tab.toLowerCase() === param?.toLowerCase()) ?? "All";
}
export const trainingsHref = (tab: TrainingTab) => (tab === "All" ? "/training" : `/training?tab=${tab.toLowerCase()}`);

// ── Materials ─────────────────────────────────────────────────────────────

export const MATERIAL_MAX_BYTES = 10 * 1024 * 1024;
/** PDF, Word, Excel or images: the file types Staff may attach, with the label each shows. */
export const MATERIAL_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "application/msword": "Word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.ms-excel": "Excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "image/png": "Image",
  "image/jpeg": "Image",
  "image/gif": "Image",
  "image/webp": "Image",
};
export const MATERIAL_ACCEPT = Object.keys(MATERIAL_TYPES).join(",");

export type MaterialRequest = { filename: string; contentType: string; size: number };
export type TrainingMaterial = { fileId: string; filename: string; contentType: string; size: number };

/** Why a file may not be attached, or null when it may. Used by the form (before uploading) and the server. */
export function materialProblem(file: { filename?: unknown; contentType?: unknown; size?: unknown }): string | null {
  const name = cleanLine(file.filename);
  if (!name || name.length > 200 || !TEXT.test(name)) return "Give the file a name of up to 200 characters, without < or >.";
  if (typeof file.contentType !== "string" || !(file.contentType in MATERIAL_TYPES)) return "Attach a PDF, Word, Excel or image file.";
  if (!Number.isInteger(file.size) || (file.size as number) <= 0) return "That file is empty.";
  if ((file.size as number) > MATERIAL_MAX_BYTES) return "Each file can be up to 10 MB.";
  return null;
}

export const materialKind = (contentType: string) => MATERIAL_TYPES[contentType] ?? "File";
/** "1.2 MB", "90 KB" */
export function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ── Assigned employees ────────────────────────────────────────────────────

export const ASSIGNMENT_STATUSES = ["Assigned", "Completed", "Did not attend", "Cancelled"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/** An Employee on a Training. `email` is null when the Employee has none, which makes them "Needs printed schedule". */
export type AssignedEmployee = {
  employeeId: number;
  name: string;
  position: string;
  branch: string;
  email: string | null;
  needsPrintedSchedule: boolean;
  status: AssignmentStatus;
  completedOn: string | null;
  /** The Training moved after this Employee was handed a printed schedule, so it needs printing again. */
  reprintNeeded: boolean;
  /** Typed by Staff from the paper feedback form; only an employee marked Completed has it. */
  feedback: TrainingFeedback | null;
};
/** An Employee the Assign dialog offers. */
export type AssignableEmployee = {
  employeeId: number;
  name: string;
  position: string;
  branch: string;
  department: string | null;
  email: string | null;
  alreadyAssigned: boolean;
};
/** Who to assign: the chosen Employees, or every Employee of one department. */
export type AssignRequest = { employeeIds: number[] } | { department: string };
export type AssignResult = { added: number; alreadyAssigned: number; needPrintedSchedule: number };

/** "Needs printed schedule" for no-email Employees, so the warning names who, in neutral wording. */
export function noEmailWarning(people: { name: string; email: string | null }[]): string | null {
  const missing = people.filter((person) => !person.email).map((person) => person.name);
  if (missing.length === 0) return null;
  const names = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `${names} ${missing.length === 1 ? "has" : "have"} no email, so ${missing.length === 1 ? "they" : "they"} won’t get the Assignment email. Print the schedule from the training page.`;
}

// ── Results ───────────────────────────────────────────────────────────────

/** What Staff can set from the paper sign-in sheet. Cancelled is automatic (the Training was cancelled) and cannot be chosen. */
export const RESULT_STATUSES = ["Assigned", "Completed", "Did not attend"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];
/** One Employee's result. A Completed result needs a completion date; the others carry none. */
export type ResultMark = { employeeId: number; status: ResultStatus; completedOn?: string | null };
export type MarkResultsResult = { marked: number };
export const RESULT_MAX_MARKS = 500;

/** Normalises and checks marks from the Mark results screen. `marks` is set only when there is no `error`. */
export function readResultMarks(raw: unknown, { trainingDate, today }: { trainingDate: string; today: string }): { marks: ResultMark[] | null; error?: string } {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > RESULT_MAX_MARKS) return { marks: null, error: "Choose at least one employee's result." };
  const seen = new Set<number>();
  const marks: ResultMark[] = [];
  for (const item of raw as Partial<ResultMark>[]) {
    const id = item?.employeeId;
    if (!Number.isInteger(id) || (id as number) <= 0 || (id as number) > 2_147_483_647 || seen.has(id as number)) return { marks: null, error: "Check the employees and try again." };
    if (!RESULT_STATUSES.includes(item.status as ResultStatus)) return { marks: null, error: "Choose Completed or Did not attend." };
    seen.add(id as number);
    if (item.status !== "Completed") { marks.push({ employeeId: id as number, status: item.status as ResultStatus, completedOn: null }); continue; }
    const date = typeof item.completedOn === "string" ? item.completedOn.trim() : "";
    if (!isDate(date)) return { marks: null, error: "Enter a completion date for everyone marked Completed." };
    if (date < trainingDate) return { marks: null, error: `A completion date can't be before the training (${formatShortDate(trainingDate)}).` };
    if (date > today) return { marks: null, error: "A completion date can't be in the future." };
    marks.push({ employeeId: id as number, status: "Completed", completedOn: date });
  }
  return { marks };
}

/** Training completion: Assigned employees marked Completed as a whole percent of the results due. */
export type TrainingCompletion = { percent: number; completed: number; due: number };
/** Null when nothing is due, so the card says "Nothing to show yet" and never 0%. */
export const completionOf = (completed: number, due: number): TrainingCompletion | null =>
  due > 0 ? { percent: Math.round((completed / due) * 100), completed, due } : null;
/** "November 2026" from a Manila "YYYY-MM-DD" date. */
export const formatMonth = (day: string) =>
  new Date(`${day.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

// ── Feedback ──────────────────────────────────────────────────────────────

/** A rating from 1 to 5 stars and optional comments, typed by Staff from the paper feedback form. */
export type TrainingFeedback = { rating: number; comments: string };
export const FEEDBACK_RATINGS = [1, 2, 3, 4, 5] as const;
export const FEEDBACK_LABELS: Record<number, string> = { 1: "Poor", 2: "Fair", 3: "Average", 4: "Good", 5: "Excellent" };
export const FEEDBACK_COMMENTS_MAX = 1000;
export const feedbackLabel = (rating: number) => `${rating} of 5 · ${FEEDBACK_LABELS[rating]}`;

/** Normalises and checks feedback. `feedback` is set only when there is no error; comments are rejected for markup, not stripped. */
export function readFeedback(raw: { rating?: unknown; comments?: unknown }): { feedback: TrainingFeedback | null; ratingError?: string; commentsError?: string } {
  const rating = raw?.rating;
  const comments = cleanLines(raw?.comments);
  const ratingError = typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5 ? undefined : "Choose a rating from 1 to 5 stars.";
  const commentsError = comments.length > FEEDBACK_COMMENTS_MAX || !TEXT.test(comments.replace(/\n/g, " "))
    ? `Use up to ${FEEDBACK_COMMENTS_MAX} characters for the comments, without < or >.` : undefined;
  return ratingError || commentsError ? { feedback: null, ratingError, commentsError } : { feedback: { rating: rating as number, comments } };
}

// ── Cancel ────────────────────────────────────────────────────────────────

export const CANCEL_REASON_MAX = 500;

/** The reason Staff give for cancelling: required, trimmed, markup rejected (not stripped). `reason` is set only when there is no error. */
export function readCancelReason(raw: unknown): { reason: string | null; error?: string } {
  const reason = cleanLines(raw);
  if (!reason) return { reason: null, error: "Enter a reason for cancelling." };
  if (reason.length > CANCEL_REASON_MAX || !TEXT.test(reason.replace(/\n/g, " "))) {
    return { reason: null, error: `Use up to ${CANCEL_REASON_MAX} characters for the reason, without < or >.` };
  }
  return { reason };
}

/** What Staff chose in the Cancel dialog. */
export type CancelRequest = { reason: string; notify: boolean };
/** `notified` Employees were queued a Cancelled email; `needPrintedSchedule` have no email and must be told directly. */
export type CancelResult = { cancelled: number; notified: number; needPrintedSchedule: number };

/** The Cancelled email. Names the Training, when it was, and why; nothing the Employee would need to sign in for. */
export function cancelledEmail(
  employeeName: string,
  training: { title: string; date: string },
  reason: string,
): { title: string; body: string } {
  const first = employeeName.trim().split(/\s+/)[0] || employeeName;
  const day = formatTrainingDate(training.date);
  return {
    title: `Cancelled: ${training.title} on ${day.replace(/,? \d{4}$/, "")}`,
    body: [
      `Hi ${first},`,
      "",
      `The training "${training.title}" on ${day} is cancelled.`,
      "",
      `Reason: ${reason}`,
      "",
      "Bren Raphael's",
    ].join("\n"),
  };
}

// ── Notification log ──────────────────────────────────────────────────────

export type LogNoticeState = "Sending" | "Sent" | "Retrying" | "Failed" | "Needs printed schedule";
export type LogTab = "All notices" | "Not reached" | "Needs printed schedule";
export const LOG_TABS: LogTab[] = ["All notices", "Not reached", "Needs printed schedule"];

/** One row of the log: a stored notice, or (for an Employee with no email) the Assignment that could not be emailed. */
export type LogRow = {
  /** Set for stored notices; null for a no-email Employee's "Needs printed schedule" row. */
  noticeId: number | null;
  employeeId: number;
  employeeName: string;
  position: string;
  branch: string;
  kind: string;
  email: string | null;
  state: LogNoticeState;
  /** When it was sent, last tried or (no email) assigned. ISO. */
  at: string;
  /** Failed sends so far, for "Try 2 of 3" and "3 tries". */
  attempts: number;
  /** When the next try is due, while Retrying. ISO. */
  nextAttemptAt: string | null;
};
/** A reschedule: what the schedule was and became, and whether Employees were told. */
export type ScheduleChange = {
  at: string;
  from: { date: string; startTime: string; endTime: string; mode: TrainingMode; location: string };
  to: { date: string; startTime: string; endTime: string; mode: TrainingMode; location: string };
  notified: boolean;
  notifiedCount: number;
  needsPrinted: number;
};
export type NotificationLog = {
  rows: LogRow[];
  scheduleChanges: ScheduleChange[];
  notReached: LogRow[];
  needsPrinted: LogRow[];
  counts: Record<LogTab, number>;
};
/** One line of the detail page's preview: a notice event with how it went. */
export type LogEvent = { kind: string; at: string; sent: number; retrying: number; failed: number; needPrinted: number; /** False when a reschedule was saved with Notify off. */ notified?: boolean };

export const logTabFromParam = (param: string | undefined): LogTab =>
  LOG_TABS.find((tab) => tab.toLowerCase().replace(/ /g, "-") === param?.toLowerCase()) ?? "All notices";
export const logHref = (trainingId: number, tab: LogTab) =>
  tab === "All notices" ? `/training/${trainingId}/log` : `/training/${trainingId}/log?tab=${tab.toLowerCase().replace(/ /g, "-")}`;

/** "11 Nov, 4:55 PM" in Manila time. */
export function formatNoticeTime(iso: string) {
  const date = new Date(iso);
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Manila" });
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Manila" });
  return `${day}, ${time}`;
}
/** "4:40 PM" in Manila time. */
export const formatClock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Manila" });

// ── Editing ───────────────────────────────────────────────────────────────

/** Whether an edit moves the Training: its date, time, Mode or venue or link. Title and text changes are not a reschedule. */
export function scheduleDiffers(a: { date: string; startTime: string; endTime: string; mode: string; location: string }, b: { date: string; startTime: string; endTime: string; mode: string; location: string }) {
  return a.date !== b.date || a.startTime !== b.startTime || a.endTime !== b.endTime || a.mode !== b.mode || a.location !== b.location;
}
export type UpdateResult = { changed: boolean; rescheduled: boolean; notified: number; needPrintedSchedule: number };
