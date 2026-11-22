import { describe, expect, it } from "vitest";
import { GO_LIVE_MESSAGE, TARGET_MESSAGE, TARGET_REQUIRED_MESSAGE, GO_LIVE_REQUIRED_MESSAGE, checkSalesSettings } from "@/lib/performance-sales-setup-terms";
import { parsePesos } from "@/lib/validators/money";

const NONE = { target: null, goLive: null };
const SET = { target: 1500, goLive: "2026-11-10" };

describe("a peso amount", () => {
  it("is whole pesos or pesos and centavos, above 0 and within the maximum", () => {
    expect(parsePesos("1500", 10_000_000)).toBe(1500);
    expect(parsePesos(" 1500.5 ", 10_000_000)).toBe(1500.5);
    expect(parsePesos("0.01", 10_000_000)).toBe(0.01);
    expect(parsePesos(250, 10_000_000)).toBe(250);
    expect(parsePesos("10000000", 10_000_000)).toBe(10_000_000);
  });

  it.each(["", "  ", "abc", "0", "0.00", "-5", "1.234", "1,500", "₱1500", "1e3", "10000001", "12.", ".5", null, undefined, Number.NaN, 1.234])("refuses %j rather than guessing", (bad) => {
    expect(parsePesos(bad, 10_000_000)).toBeNull();
  });
});

describe("the Sales settings fields", () => {
  it("send only what changed, and only when valid", () => {
    expect(checkSalesSettings({ target: "1500", goLive: "2026-11-10" }, SET)).toMatchObject({ changes: {}, canSave: false });
    expect(checkSalesSettings({ target: "1600", goLive: "2026-11-10" }, SET)).toMatchObject({ changes: { target: 1600 }, canSave: true });
    expect(checkSalesSettings({ target: "1500", goLive: "2026-12-01" }, SET)).toMatchObject({ changes: { goLive: "2026-12-01" }, canSave: true });
    expect(checkSalesSettings({ target: "1600.25", goLive: "2026-12-01" }, SET).changes).toEqual({ target: 1600.25, goLive: "2026-12-01" });
  });

  it("can be saved one at a time while the other has nothing saved yet", () => {
    expect(checkSalesSettings({ target: "1500", goLive: "" }, NONE)).toMatchObject({ changes: { target: 1500 }, goLiveError: null, canSave: true });
    expect(checkSalesSettings({ target: "", goLive: "2026-11-10" }, NONE)).toMatchObject({ changes: { goLive: "2026-11-10" }, targetError: null, canSave: true });
    expect(checkSalesSettings({ target: "", goLive: "" }, NONE)).toMatchObject({ changes: {}, canSave: false });
  });

  it("refuse a bad target or date with a clear message and send nothing", () => {
    expect(checkSalesSettings({ target: "abc", goLive: "2026-11-10" }, SET)).toMatchObject({ targetError: TARGET_MESSAGE, canSave: false });
    expect(checkSalesSettings({ target: "0", goLive: "2026-11-10" }, SET).targetError).toBe(TARGET_MESSAGE);
    expect(checkSalesSettings({ target: "12.345", goLive: "2026-11-10" }, SET).targetError).toBe(TARGET_MESSAGE);
    expect(checkSalesSettings({ target: "1500", goLive: "2026-02-30" }, SET)).toMatchObject({ goLiveError: GO_LIVE_MESSAGE, canSave: false });
    expect(checkSalesSettings({ target: "1500", goLive: "10 November" }, SET).goLiveError).toBe(GO_LIVE_MESSAGE);
    // A bad value in one field stops the other from being sent too.
    expect(checkSalesSettings({ target: "abc", goLive: "2026-12-01" }, SET).changes).toEqual({ goLive: "2026-12-01" });
    expect(checkSalesSettings({ target: "abc", goLive: "2026-12-01" }, SET).canSave).toBe(false);
  });

  it("do not let a saved value be cleared", () => {
    expect(checkSalesSettings({ target: "", goLive: "2026-11-10" }, SET)).toMatchObject({ targetError: TARGET_REQUIRED_MESSAGE, canSave: false });
    expect(checkSalesSettings({ target: "1500", goLive: "" }, SET)).toMatchObject({ goLiveError: GO_LIVE_REQUIRED_MESSAGE, canSave: false });
  });
});
