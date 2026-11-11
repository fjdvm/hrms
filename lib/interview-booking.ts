import places from "./data/philippine-places.json";
import type { InterviewInput } from "./applications";

/** PSGC province names; independent cities are grouped under their region. */
export const PHILIPPINE_PLACES: Record<string, string[]> = places;
export type FreeInterviewSlot = { startsAt: string; endsAt: string };
export type InterviewConflict = { applicantName: string; startsAt: string; endsAt: string };

export function interviewValidation(input: InterviewInput, now = Date.now()): string | undefined {
  const timestamp = (value: unknown) => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  const text = (value: unknown) => typeof value === "string" && value.trim() !== "";
  const link = (value: unknown) => {
    if (!text(value)) return false;
    try { return ["https:", "http:"].includes(new URL(value as string).protocol); } catch { return false; }
  };
  if (!input || !timestamp(input.startsAt) || !timestamp(input.endsAt)) return "Provide valid start and end times with a timezone.";
  const start = Date.parse(input.startsAt), end = Date.parse(input.endsAt);
  const localStart = new Date(start + 8 * 3600000), localEnd = new Date(end + 8 * 3600000);
  if (start <= now) return "Start must be in the future.";
  if ([0, 6].includes(localStart.getUTCDay())) return "Interviews must be Monday to Friday in Manila.";
  if (end <= start) return "End must be after start.";
  if (localStart.getUTCHours() < 8) return "Start must be at or after 8 AM in Manila.";
  if (localStart.toISOString().slice(0, 10) !== localEnd.toISOString().slice(0, 10)
    || localEnd.getUTCHours() > 17 || (localEnd.getUTCHours() === 17 && (localEnd.getUTCMinutes() || localEnd.getUTCSeconds() || localEnd.getUTCMilliseconds()))) return "End must be no later than 5 PM on the same Manila day.";
  if (input.type !== "Online" && input.type !== "In person") return "Choose Online or In person.";
  if (input.type === "Online" && !link(input.meetingLink)) return "Online Interviews need a valid meeting link.";
  if (input.type === "In person" && (!text(input.province) || !text(input.city)
    || !Object.hasOwn(PHILIPPINE_PLACES, input.province!) || !PHILIPPINE_PLACES[input.province!].includes(input.city!)
    || !text(input.address))) return "In person Interviews need a listed Philippine province and city or municipality, and an address.";
  if (input.mapLink !== undefined && input.mapLink !== "" && !link(input.mapLink)) return "Provide a valid map link.";
  if (!text(input.interviewerId)) return "Choose an eligible Interviewer.";
}

/** Suggest up to four duration-matched slots, starting on the requested Manila day. */
export function freeInterviewSlots(input: InterviewInput, busy: InterviewConflict[], now = Date.now()): FreeInterviewSlot[] {
  const duration = Date.parse(input.endsAt) - Date.parse(input.startsAt);
  const day = new Date(Date.parse(input.startsAt) + 8 * 3600000);
  day.setUTCHours(0, 0, 0, 0);
  const slots: FreeInterviewSlot[] = [];
  for (let offset = 0; offset < 30 && slots.length < 4; offset++) {
    const date = new Date(day.getTime() + offset * 86400000);
    if ([0, 6].includes(date.getUTCDay())) continue;
    // Manila 08:00 is UTC midnight; consider half-hour boundaries.
    for (let start = date.getTime(); start + duration <= date.getTime() + 9 * 3600000 && slots.length < 4; start += 1800000) {
      if (start <= now || busy.some(item => start < Date.parse(item.endsAt) && start + duration > Date.parse(item.startsAt))) continue;
      slots.push({ startsAt: new Date(start).toISOString(), endsAt: new Date(start + duration).toISOString() });
    }
  }
  return slots;
}
