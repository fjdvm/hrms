/** Working days are ISO weekdays: 1 = Monday ... 7 = Sunday. */
export const WEEKDAYS = [
  { day: 1, short: "Mon" }, { day: 2, short: "Tue" }, { day: 3, short: "Wed" }, { day: 4, short: "Thu" },
  { day: 5, short: "Fri" }, { day: 6, short: "Sat" }, { day: 7, short: "Sun" },
] as const;

/** At least one day, each a whole number from 1 to 7. */
export const isWorkingDays = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length > 0 && value.every((day) => Number.isInteger(day) && day >= 1 && day <= 7);

/** The form holds Working days as "1,2,3"; this reads it back as sorted, distinct days, or null when it is empty or invalid. */
export function parseWorkingDays(text: string): number[] | null {
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const days = parts.map((part) => (/^\d$/.test(part) ? Number(part) : Number.NaN));
  return isWorkingDays(days) ? [...new Set(days)].sort((a, b) => a - b) : null;
}

export const serializeWorkingDays = (days: readonly number[]) => [...new Set(days)].sort((a, b) => a - b).join(",");

/** "Mon, Tue, Wed" in week order. */
export const formatWorkingDays = (days: readonly number[]) =>
  WEEKDAYS.filter(({ day }) => days.includes(day)).map(({ short }) => short).join(", ");
