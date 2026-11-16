import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttendanceError, PerformanceError } from "@/lib/performance";

const state = vi.hoisted(() => ({ performance: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock("@/lib/portal/performance", () => ({ performanceForRequest: async () => state.performance }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { confirmNoAttendance, resolveAttendanceDay } from "@/app/(hrms)/performance/actions";

beforeEach(() => { state.performance = { resolveDay: vi.fn(), confirmNoAttendance: vi.fn() }; cache.revalidatePath.mockClear(); });

describe("the attendance issue server actions", () => {
  it("resolves a day through the interface and refreshes the list and that Employee's page", async () => {
    expect(await resolveAttendanceDay(12, 2, "2026-11-09", { type: "Absent", reason: "Left early" })).toEqual({ ok: true });
    expect(state.performance.resolveDay).toHaveBeenCalledWith(12, 2, "2026-11-09", { type: "Absent", reason: "Left early" });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/performance");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/performance/evaluation/12");
  });

  it("confirms no attendance with the reason", async () => {
    expect(await confirmNoAttendance(12, 2, "On leave all month")).toEqual({ ok: true });
    expect(state.performance.confirmNoAttendance).toHaveBeenCalledWith(12, 2, "On leave all month");
  });

  it("turns refusals into the words HR reads and does not refresh", async () => {
    state.performance.resolveDay.mockRejectedValue(new AttendanceError("reason-required"));
    expect(await resolveAttendanceDay(12, 2, "2026-11-09", { type: "Absent", reason: "" })).toEqual({ ok: false, error: "Enter a reason." });
    state.performance.resolveDay.mockRejectedValue(new AttendanceError("not-an-open-issue"));
    expect((await resolveAttendanceDay(12, 2, "2026-11-09", { type: "Excused" })).ok).toBe(false);
    state.performance.confirmNoAttendance.mockRejectedValue(new AttendanceError("has-attendance"));
    expect(await confirmNoAttendance(12, 2, "x")).toEqual({ ok: false, error: "This employee now has attendance records for the period. Reload the page." });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("sends Staff without the Module to No access", async () => {
    state.performance.resolveDay.mockRejectedValue(new PerformanceError("denied"));
    await expect(resolveAttendanceDay(12, 2, "2026-11-09", { type: "Excused" })).rejects.toThrow("REDIRECT /no-access");
  });
});
