import { rangeLabel } from "./performance-period-form";
import { MAX_CUSTOM_DAYS, MAX_GRACE_MINUTES, NAME_MAX_LENGTH, NOTES_MAX_LENGTH, type PeriodProblem } from "./performance-periods";

/** What HR reads when a period or company-calendar change is refused. The server actions and the dialogs use the same words. */
export const NAME_CHARACTERS_MESSAGE = "Name can only contain letters, numbers, spaces and . , ' & ( ) / + -";

/** The error on the Period field when a range overlaps another period, as in the Figma Overlap frame. */
export const overlapMessage = (overlap: { name: string; start: string; end: string }) => `Overlaps ${overlap.name} (${rangeLabel(overlap)}).`;

export function periodMessage(problem: PeriodProblem, extra: { overlaps?: { id: number; name: string }; existing?: string } = {}): string {
  switch (problem) {
    case "overlap": return extra.overlaps ? `Overlaps ${extra.overlaps.name}. Periods can't overlap by date.` : "This period overlaps another one. Periods can't overlap by date.";
    case "dates-invalid": case "date-invalid": return "Choose a real date.";
    case "end-before-start": return "The end date can't be before the start date.";
    case "range-too-long": return `A custom period covers at most ${MAX_CUSTOM_DAYS} days.`;
    case "grace-invalid": return `Grace period must be whole minutes from 0 to ${MAX_GRACE_MINUTES}.`;
    case "year-invalid": case "type-invalid": return "Choose a month, quarter or custom range.";
    case "name-empty": return "Enter a name.";
    case "name-too-long": return `Name is too long (${NAME_MAX_LENGTH} characters at most).`;
    case "name-characters": return NAME_CHARACTERS_MESSAGE;
    case "notes-invalid": return `Notes can't contain control characters and are ${NOTES_MAX_LENGTH} characters at most.`;
    case "calendar-type-invalid": return "Choose Holiday, Closure or Other.";
    case "date-taken": return extra.existing ? `That date is already on the calendar as ${extra.existing}.` : "That date is already on the calendar.";
    case "unknown-entry": return "That date is no longer on the calendar. Reload the page.";
    default: return "Something went wrong. Reload the page and try again.";
  }
}
