/** A clock time on the 24-hour clock, "HH:MM" (what a time input holds and the shift columns store). */
export const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isClockTime = (value: unknown): value is string => typeof value === "string" && CLOCK_TIME.test(value);

/** Minutes since midnight for a valid "HH:MM". */
export function minutesOf(time: string): number {
  if (!isClockTime(time)) throw new RangeError(`Not a clock time: ${time}`);
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** True when `end` is later in the day than `start`. Overnight spans are not supported, so end <= start is false. */
export const isAfter = (end: string, start: string) => minutesOf(end) > minutesOf(start);

/** "06:00" as "6:00 AM", "14:30" as "2:30 PM". */
export function formatClockTime(time: string): string {
  const total = minutesOf(time);
  const hours = Math.floor(total / 60);
  return `${hours % 12 === 0 ? 12 : hours % 12}:${time.slice(3, 5)} ${hours < 12 ? "AM" : "PM"}`;
}
