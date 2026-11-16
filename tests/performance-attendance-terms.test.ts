import { describe, expect, it } from "vitest";
import { attendanceMessage, checkReason } from "@/lib/performance-attendance-terms";

describe("the attendance-issue reason", () => {
  it("is optional for Excused and required for Absent and for confirming no attendance", () => {
    expect(checkReason("", false)).toBeNull();
    expect(checkReason("   ", false)).toBeNull();
    expect(checkReason("", true)).toBe("Enter a reason.");
    expect(checkReason("  \n ", true)).toBe("Enter a reason.");
    expect(checkReason("Approved leave", true)).toBeNull();
  });

  it("refuses control characters and too much text instead of changing them", () => {
    expect(checkReason("a\u0007b", false)).toMatch(/can’t contain control characters/);
    expect(checkReason("x".repeat(500), true)).toBeNull();
    expect(checkReason("x".repeat(501), true)).toMatch(/500 characters/);
  });

  it("words each refusal for the dialogs", () => {
    expect(attendanceMessage("reason-required")).toBe("Enter a reason.");
    expect(attendanceMessage("not-an-open-issue")).toMatch(/no longer an open issue/);
    expect(attendanceMessage("has-attendance")).toMatch(/now has attendance records/);
    expect(attendanceMessage("nope")).toMatch(/Reload the page/);
  });
});
