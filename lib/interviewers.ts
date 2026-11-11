import { createHash } from "node:crypto";

/** Fixed Calendar palette; assignments depend only on Portal id, never directory order or size. */
export const INTERVIEWER_COLOURS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2"] as const;
export type Interviewer = { id: string; name: string; colour: string };

export function interviewerColour(id: string): string {
  return INTERVIEWER_COLOURS[createHash("sha256").update(id).digest().readUInt32BE(0) % INTERVIEWER_COLOURS.length];
}
