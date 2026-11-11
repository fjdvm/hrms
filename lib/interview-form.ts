import type { InterviewInput } from "./applications";
import type { FreeInterviewSlot } from "./interview-booking";

/** The Schedule interview form. Dates are "YYYY-MM-DD" and times "HH:mm", both Manila wall-clock. */
export type InterviewFormValues = {
  type: InterviewInput["type"]; date: string; start: string; end: string; interviewerId: string;
  meetingLink: string; province: string; city: string; address: string; mapLink: string;
};
export type InterviewField = "date" | "start" | "end" | "interviewerId" | "meetingLink" | "province" | "city" | "address" | "mapLink";
export type InterviewFormErrors = Partial<Record<InterviewField, string>>;

const MANILA_HOURS = 8 * 3600000;
const pad = (n: number) => String(n).padStart(2, "0");

/** Today in Manila as "YYYY-MM-DD". */
export const manilaToday = (now = Date.now()) => new Date(now + MANILA_HOURS).toISOString().slice(0, 10);
/** The Manila date and time of an instant. */
export function manilaParts(instant: Date | string) {
  const iso = new Date(new Date(instant).getTime() + MANILA_HOURS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
export const dayToDate = (day: string) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
export const dateToDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Days the date picker refuses: every past day and every weekend. */
export const unbookableDays = (today: string) => [{ before: dayToDate(today) }, { dayOfWeek: [0, 6] }];

const isLink = (value: string) => { try { return ["https:", "http:"].includes(new URL(value.trim()).protocol); } catch { return false; } };

export function interviewFormErrors(form: InterviewFormValues, now = Date.now()): InterviewFormErrors {
  const errors: InterviewFormErrors = {};
  const today = manilaToday(now);
  if (!form.date) errors.date = "Choose a date.";
  else if (form.date < today) errors.date = "Choose today or a later day.";
  else if ([0, 6].includes(dayToDate(form.date).getDay())) errors.date = "Interviews are Monday to Friday.";
  if (!form.start) errors.start = "Choose a start time.";
  else if (form.start < "08:00") errors.start = "Start time must be 8 AM or later.";
  else if (form.start >= "17:00") errors.start = "Start time must be before 5 PM.";
  else if (form.date && !errors.date && Date.parse(`${form.date}T${form.start}:00+08:00`) <= now) errors.start = "That start time has already passed.";
  if (!form.end) errors.end = "Choose an end time.";
  else if (form.end > "17:00") errors.end = "End time must be 5 PM or earlier.";
  else if (form.start && form.end <= form.start) errors.end = "End time must be after the start.";
  if (!form.interviewerId) errors.interviewerId = "Choose the Interviewer.";
  if (form.type === "Online") {
    if (!form.meetingLink.trim()) errors.meetingLink = "Paste the meeting link.";
    else if (!isLink(form.meetingLink)) errors.meetingLink = "Enter a valid link starting with https://.";
  } else {
    if (!form.province) errors.province = "Choose a province.";
    if (!form.city) errors.city = "Choose a city or municipality.";
    if (!form.address.trim()) errors.address = "Enter the street, building and barangay.";
    if (form.mapLink.trim() && !isLink(form.mapLink)) errors.mapLink = "Enter a valid link starting with https://.";
  }
  return errors;
}

export function interviewInputFrom(form: InterviewFormValues, interviewerName: string): InterviewInput {
  const base = { startsAt: `${form.date}T${form.start}:00+08:00`, endsAt: `${form.date}T${form.end}:00+08:00`, type: form.type, interviewerId: form.interviewerId, interviewerName };
  return form.type === "Online"
    ? { ...base, meetingLink: form.meetingLink.trim() }
    : { ...base, province: form.province, city: form.city, address: form.address.trim(), ...(form.mapLink.trim() && { mapLink: form.mapLink.trim() }) };
}

export const formatClock = (time: string) => {
  const hours = Number(time.slice(0, 2));
  return `${hours % 12 || 12}:${time.slice(3, 5)} ${hours < 12 ? "AM" : "PM"}`;
};
/** "2:15 – 2:45 PM". */
export function formatTimeRange(start: string, end: string) {
  const [a, b] = [formatClock(start), formatClock(end)];
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}
const longDay = (day: string) => dayToDate(day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
/** "Thu, 12 Nov 2026". */
export const formatDay = (day: string) => {
  const date = dayToDate(day);
  return `${date.toLocaleDateString("en-GB", { weekday: "short" })}, ${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
};

/** A free-slot pill: "Today · 3:00 PM" or "Fri 13 · 10:00 AM". */
export function slotLabel(slot: FreeInterviewSlot, today: string) {
  const { date, time } = manilaParts(slot.startsAt);
  const day = date === today ? "Today" : dayToDate(date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
  return `${day} · ${formatClock(time)}`;
}

/** The fixed invite wording the Applicant will read; HR sees it but cannot edit it. */
export function invitePreview(form: InterviewFormValues, applicantName: string, jobTitle: string, interviewerName: string) {
  const first = applicantName.split(" ")[0];
  const when = form.date && form.start ? `${longDay(form.date)} at ${formatClock(form.start)}` : "the date and time you choose";
  const who = interviewerName || "your Interviewer";
  if (form.type === "Online") {
    return { subject: `Your online interview for ${jobTitle}`, body: `Hi ${first}, you’re invited to an online interview on ${when} with ${who}. Join here: ${form.meetingLink.trim() || "the meeting link"}` };
  }
  const place = [form.address.trim(), form.city, form.province].filter(Boolean).join(", ") || "the address you enter";
  return { subject: `Your interview for ${jobTitle}`, body: `Hi ${first}, please come to ${place} on ${when} for your interview with ${who}.${form.mapLink.trim() ? ` Directions: ${form.mapLink.trim()}` : ""}` };
}
