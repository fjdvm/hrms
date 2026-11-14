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

const isDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
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
export function readTrainingForm(raw: Record<string, string>, today = manilaToday()): { terms: TrainingTerms | null; errors: TrainingFormErrors } {
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
  else if (terms.date < today) errors.date = "The date can't be in the past.";
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
