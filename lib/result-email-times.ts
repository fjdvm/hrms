const MANILA_OFFSET_MS = 8 * 3_600_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type SendTimeOption = { label: string; value: string };

/** Manila wall-clock `hour` on the day `days` after the Manila day of `now`, as an instant. */
function manilaAt(now: Date, days: number, hour: number): Date {
  const day = Math.floor((now.getTime() + MANILA_OFFSET_MS) / DAY_MS) + days;
  return new Date(day * DAY_MS + hour * HOUR_MS - MANILA_OFFSET_MS);
}

const clock = (date: Date) => date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
const day = (date: Date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Manila" });

/** When the result email can go out: later today if there is time, then the next mornings. Values are ISO instants (Manila time). */
export function sendTimeOptions(now: Date): SendTimeOption[] {
  const options: SendTimeOption[] = [];
  const evening = manilaAt(now, 0, 18);
  if (evening.getTime() - now.getTime() >= 30 * 60_000) options.push({ label: `Today, ${day(evening)} · ${clock(evening)}`, value: evening.toISOString() });
  const tomorrow = manilaAt(now, 1, 9);
  options.push({ label: `Tomorrow, ${day(tomorrow)} · ${clock(tomorrow)}`, value: tomorrow.toISOString() });
  const later = manilaAt(now, 2, 9);
  options.push({ label: `${later.toLocaleDateString("en-GB", { weekday: "short", timeZone: "Asia/Manila" })}, ${day(later)} · ${clock(later)}`, value: later.toISOString() });
  return options;
}
