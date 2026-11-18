import { describe, expect, it } from "vitest";
import { ACTION_MAX_LENGTH, GAP_MAX_LENGTH, NEED_MESSAGES, checkNeedText, needMessage, type NeedProblem } from "@/lib/performance-needs-terms";

describe("the rules the Flag development need dialog shares with the server", () => {
  it.each(["gap", "action"] as const)("%s: required, cleaned and limited", (field) => {
    const max = field === "gap" ? GAP_MAX_LENGTH : ACTION_MAX_LENGTH;
    expect(checkNeedText(field, "")).toBe(`${field}-required`);
    expect(checkNeedText(field, " \n\t ")).toBe(`${field}-required`);
    expect(checkNeedText(field, "a\u0000b")).toBe(`${field}-invalid`);
    expect(checkNeedText(field, `a${String.fromCharCode(0x202e)}b`)).toBe(`${field}-invalid`);
    expect(checkNeedText(field, "x".repeat(max))).toBeNull();
    expect(checkNeedText(field, "x".repeat(max + 1))).toBe(`${field}-too-long`);
    expect(checkNeedText(field, `${"x ".repeat(max / 2 - 1)}\n\n\n\n`)).toBeNull();
    expect(checkNeedText(field, "Cash counting at closing is below target.")).toBeNull();
  });
  it("has a plain message for every problem, and none shows an internal code", () => {
    const problems = Object.keys(NEED_MESSAGES) as NeedProblem[];
    expect(problems).toHaveLength(8);
    for (const problem of problems) {
      expect(needMessage(problem).length).toBeGreaterThan(10);
      expect(needMessage(problem)).not.toMatch(/AI-\d{4}|[a-z]+-[a-z]+-[a-z]+/);
    }
    expect(needMessage("gap-too-long")).toBe("Gap is too long (200 characters at most).");
    expect(needMessage("action-too-long")).toBe("Recommended action is too long (300 characters at most).");
  });
});
