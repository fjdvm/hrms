/** Append-only Calendar palette: persisted indexes must keep their original meaning. */
export const INTERVIEWER_COLOURS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2"] as const;
export type Interviewer = { id: string; name: string; colour: string };
