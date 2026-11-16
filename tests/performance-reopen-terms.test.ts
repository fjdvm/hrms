import { describe, expect, it } from "vitest";
import { checkReopenReason, reopenMessage } from "@/lib/performance-reopen-terms";
import { REOPENING_NOTE, keptVersionNote } from "@/lib/performance-evaluation-view";

describe("the reopen reason", () => {
  it("is required, over one or more lines", () => {
    expect(checkReopenReason("")).toBe("Enter the reason for reopening.");
    expect(checkReopenReason("  \n \n ")).toBe("Enter the reason for reopening.");
    expect(checkReopenReason("Attendance import for 12 Nov was corrected.")).toBeNull();
    expect(checkReopenReason("Line one\nLine two")).toBeNull();
  });

  it("refuses control characters and too much text instead of changing them", () => {
    expect(checkReopenReason("a\u0007b")).toMatch(/can’t contain control/);
    expect(checkReopenReason("x".repeat(500))).toBeNull();
    expect(checkReopenReason("x".repeat(501))).toMatch(/500 characters/);
  });

  it("words each refusal for the dialog", () => {
    expect(reopenMessage("reason-required")).toBe("Enter the reason for reopening.");
    expect(reopenMessage("not-evaluated")).toMatch(/nothing to reopen/);
  });
});

describe("the Reopening note and the kept version", () => {
  const version = { version: 1, outcome: "scored" as const, score: 93, rating: 85, weightSetName: "Default", submittedByName: "Ada Okafor", submittedAt: "2026-11-30 02:00:00+00", reopened: { reason: "Import corrected.", reopenedByName: "Bo Cruz", reopenedAt: "2026-12-02 03:00:00+00" } };

  it("reads as the ticket words it", () => {
    expect(REOPENING_NOTE).toBe("Any Staff member who holds Performance can reopen a submitted evaluation, with a recorded reason. The previous version is kept.");
  });

  it("notes the version that is kept after a reopen, with who, when and why", () => {
    expect(keptVersionNote({ history: [version], submitted: null })).toBe("Reopened by Bo Cruz on 2 Dec 2026: Import corrected. Version 1, submitted on 30 Nov 2026 (93.0), is kept.");
    expect(keptVersionNote({ history: [{ ...version, outcome: "insufficient-data", score: null, reopened: null }], submitted: null })).toBe("Version 1, submitted on 30 Nov 2026 (Insufficient data), is kept.");
  });

  it("says nothing while submitted or when there was never a submit", () => {
    expect(keptVersionNote({ history: [version], submitted: {} as never })).toBeNull();
    expect(keptVersionNote({ history: [], submitted: null })).toBeNull();
  });
});
